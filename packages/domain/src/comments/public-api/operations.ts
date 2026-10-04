import { CommentId } from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  CrmEntryLimitReachedError,
  InvalidSubjectError,
  SubjectNotFoundError,
} from "../../identity/errors";
import type { OnBehalfSubject } from "../../identity/service";
import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import { crmLimitMessage } from "../../public-api/entitlement";
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  PlanRequiresUpgradeError,
  conflictError,
  invalidRequestError,
  notFoundError,
  planRequiresUpgradeError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { BadRequestError, InternalServerError } from "../../rpc-errors";
import {
  type FailedToCreateCommentError,
  type FailedToDeleteCommentError,
  type FailedToPinCommentError,
  type FailedToUnpinCommentError,
  type FailedToUpdateCommentError,
  type PostDoesNotAcceptCommentsError,
} from "../errors";
import { currentCommentService } from "../service";
import { toPublicApiComment } from "./mappers";
import { currentPublicApiCommentRepository } from "./repository";
import {
  CreateCommentInput,
  DeleteCommentInput,
  GetCommentInput,
  ListPostCommentsInput,
  PinCommentInput,
  PublicApiComment,
  PublicApiCommentPage,
  type TPublicApiComment,
  type TPublicApiCommentAuthorSubject,
  UnpinCommentInput,
  UpdateCommentInput,
} from "./schema";

const COMMENT_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * A create can be refused because the post no longer accepts comments, and
 * because attributing it to a subject with no contact yet would provision one.
 */
const COMMENT_CREATE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  PlanRequiresUpgradeError,
  InternalError,
]);

/** Every other comment write can miss its row, but never conflicts. */
const COMMENT_MUTATE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * The comment write service's failures, answered on the published vocabulary.
 *
 * Every comment endpoint reads the comment — or the post it comments on —
 * before it writes, so a `FailedTo*` failure means the row moved between the
 * read and the write: the honest answer is the documented not-found, the same
 * reasoning as a company update that matched no row. A rejected author subject
 * is the caller's input; a create that fails has nothing the caller can retry
 * into a different outcome, so it stays a server fault.
 */
type CommentWriteFailure =
  | BadRequestError
  | FailedToCreateCommentError
  | FailedToDeleteCommentError
  | FailedToPinCommentError
  | FailedToUnpinCommentError
  | FailedToUpdateCommentError
  | InternalServerError
  | InvalidSubjectError
  | SubjectNotFoundError;

const commentWriteFailureHandlers = {
  BadRequestError: (error: BadRequestError) =>
    Effect.fail(
      invalidRequestError(error.message ?? "The request is not valid.")
    ),
  FailedToCreateCommentError: () => onInternalError,
  FailedToDeleteCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  FailedToPinCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  FailedToUnpinCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  FailedToUpdateCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  InternalServerError: () => onInternalError,
  // Fixed messages: the identity failures carry a subject id in their detail,
  // and echoing a caller's own identifier back would make the error body an
  // existence oracle.
  InvalidSubjectError: () =>
    Effect.fail(
      invalidRequestError(
        "The comment's author could not be resolved in this workspace."
      )
    ),
  SubjectNotFoundError: () =>
    Effect.fail(
      invalidRequestError(
        "The comment's author could not be found in this workspace."
      )
    ),
} as const;

const withCommentWriteFailures = <A, R>(
  effect: Effect.Effect<A, CommentWriteFailure, R>
) => effect.pipe(Effect.catchTags(commentWriteFailureHandlers));

/**
 * The create's failures: the shared vocabulary plus the post-state conflict.
 *
 * Only a create can raise the state error. The post is re-checked inside the
 * write's own transaction, so a lock or a merge that lands after the handler's
 * existence check is still refused — with the message and status the ordinary
 * path produces.
 */
const withCommentCreateFailures = <A, R>(
  effect: Effect.Effect<
    A,
    | CommentWriteFailure
    | CrmEntryLimitReachedError
    | PostDoesNotAcceptCommentsError,
    R
  >
) =>
  effect.pipe(
    Effect.catchTags({
      ...commentWriteFailureHandlers,
      PostDoesNotAcceptCommentsError: (error: PostDoesNotAcceptCommentsError) =>
        Effect.fail(conflictError(error.message)),
      // Naming a subject that has no contact yet makes the write provision one,
      // which is a CRM entry like any other and is capped like any other. Same
      // remedy as the company create's limit, so it answers with that code.
      CrmEntryLimitReachedError: () =>
        Effect.fail(planRequiresUpgradeError(crmLimitMessage)),
    })
  );

/**
 * The DTO's author subject as identity resolution reads it.
 *
 * Written out rather than passed through, so a field added to the published
 * payload is a deliberate edit here instead of something the resolver starts
 * consulting on its own.
 */
const toOnBehalfSubject = (
  author: TPublicApiCommentAuthorSubject
): OnBehalfSubject => ({
  userId: author.userId,
  contactId: author.contactId,
  externalId: author.externalId,
  email: author.email,
  name: author.name,
  avatarUrl: author.avatarUrl,
});

/**
 * The comment a write just landed, read back for the response.
 *
 * The write path returns nothing a payload can be built from — the author's
 * display fields live on the `user` row — so the response is the same read a
 * later `GET` performs. `None` after a write that reported success means the
 * row was deleted between the two, which is the documented not-found rather
 * than a server error the caller cannot act on.
 */
const readWrittenComment = (args: {
  readonly commentId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* currentPublicApiCommentRepository;
    const found = yield* repository
      .findComment(args)
      .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

    return yield* Option.match(found, {
      onNone: () => Effect.fail(notFoundError("Comment not found.")),
      onSome: (comment) =>
        Effect.succeed(toPublicApiComment(comment) satisfies TPublicApiComment),
    });
  });

/**
 * The comment operations.
 *
 * The writes are the dashboard's own `CommentService` with a null actor and an
 * `on_behalf` author, so an API-created comment lands in the same transaction,
 * the same timeline, and the same notification fan-out as one written by a
 * member. These records are what an MCP tool or a CLI would call; the HTTP
 * endpoints in `./http.ts` only parse the request.
 */

export const listPostCommentsOperation = defineOperation(
  "listPostComments",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "List a post's comments, newest first.",
    failure: COMMENT_READ_FAILURES,
    input: ListPostCommentsInput,
    output: PublicApiCommentPage,
    scope: "comments.read",
  },
  ({ cursor, limit, postId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCommentRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .listPostComments({
          cursor: after,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          postId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(page, {
        // Not found rather than an empty page: a post with no comments
        // and a post that does not exist must not look the same, and
        // another workspace's post is reported as missing so the id
        // cannot probe at all.
        onNone: () => Effect.fail(notFoundError("Post not found.")),
        onSome: (found) =>
          Effect.succeed({
            data: found.comments.map(toPublicApiComment),
            nextCursor:
              found.nextCursor === null ? null : encodeCursor(found.nextCursor),
          }),
      });
    })
);

export const getCommentOperation = defineOperation(
  "getComment",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "Read one comment by id.",
    failure: COMMENT_READ_FAILURES,
    input: GetCommentInput,
    output: PublicApiComment,
    scope: "comments.read",
  },
  ({ commentId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCommentRepository;

      const comment = yield* repository
        .findComment({
          commentId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(comment, {
        onNone: () => Effect.fail(notFoundError("Comment not found.")),
        onSome: (found) =>
          Effect.succeed(toPublicApiComment(found) satisfies TPublicApiComment),
      });
    })
);

export const createCommentOperation = defineOperation(
  "createComment",
  {
    description:
      "Comment on a post, attributed to the customer the request names.",
    failure: COMMENT_CREATE_FAILURES,
    input: CreateCommentInput,
    output: PublicApiComment,
    scope: "comments.create",
  },
  ({ author, content, parentCommentId, postId, visibility }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCommentRepository;
      const comments = yield* currentCommentService;

      const target = yield* repository
        .findCommentTarget({
          organizationId: caller.organizationId,
          postId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(target)) {
        return yield* notFoundError("Post not found.");
      }

      const commentId = yield* CommentId.generate.pipe(
        Effect.catchTag("LegidError", () => onInternalError)
      );

      yield* comments
        .create({
          // A machine key is not a member: the timeline records no actor,
          // and the comment is authored by the customer the request names
          // because there is no session user to author it.
          actor: { memberId: null, userId: null },
          author: {
            kind: "on_behalf",
            subject: toOnBehalfSubject(author),
          },
          draft: {
            content,
            id: commentId,
            organizationId: caller.organizationId,
            parentCommentId: parentCommentId ?? null,
            postId,
            visibility: visibility ?? "PUBLIC",
          },
          // No status update: moving a post's status is a post edit, not
          // something the Public API does through a comment.
        })
        .pipe(withCommentCreateFailures);

      return yield* readWrittenComment({
        commentId,
        organizationId: caller.organizationId,
      });
    })
);

export const updateCommentOperation = defineOperation(
  "updateComment",
  {
    description: "Replace a comment's body, and its visibility when given.",
    failure: COMMENT_MUTATE_FAILURES,
    input: UpdateCommentInput,
    output: PublicApiComment,
    scope: "comments.update",
  },
  ({ commentId, content, visibility }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCommentRepository;
      const comments = yield* currentCommentService;

      // Read first so another workspace's comment is a 404 rather than an
      // update that matches no row and answers 200. The post id comes from
      // the read because the write path scopes its predicate by it.
      const comment = yield* repository
        .findComment({
          commentId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(comment)) {
        return yield* notFoundError("Comment not found.");
      }

      yield* comments
        .update({
          actor: { memberId: null, userId: null },
          edit: {
            content,
            id: commentId,
            organizationId: caller.organizationId,
            postId: comment.value.postId,
            visibility,
          },
        })
        .pipe(withCommentWriteFailures);

      return yield* readWrittenComment({
        commentId,
        organizationId: caller.organizationId,
      });
    })
);

export const deleteCommentOperation = defineOperation(
  "deleteComment",
  {
    annotations: { destructive: true },
    description: "Delete a comment and every reply beneath it.",
    failure: COMMENT_MUTATE_FAILURES,
    input: DeleteCommentInput,
    output: Schema.Void,
    scope: "comments.delete",
  },
  ({ commentId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCommentRepository;
      const comments = yield* currentCommentService;

      // A comment that is already gone is a 404 rather than a success: the
      // caller cannot tell a delete that worked from one that named the
      // wrong workspace, and the second is worth knowing.
      const comment = yield* repository
        .findComment({
          commentId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(comment)) {
        return yield* notFoundError("Comment not found.");
      }

      yield* comments
        .remove({
          actor: { memberId: null, userId: null },
          target: {
            id: commentId,
            organizationId: caller.organizationId,
            postId: comment.value.postId,
          },
        })
        .pipe(withCommentWriteFailures);

      return undefined;
    })
);

export const pinCommentOperation = defineOperation(
  "pinComment",
  {
    description: "Pin a comment to the top of its post.",
    failure: COMMENT_MUTATE_FAILURES,
    input: PinCommentInput,
    output: PublicApiComment,
    scope: "comments.pin",
  },
  ({ commentId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCommentRepository;
      const comments = yield* currentCommentService;

      const comment = yield* repository
        .findComment({
          commentId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(comment)) {
        return yield* notFoundError("Comment not found.");
      }

      yield* comments
        .pin({
          actor: { memberId: null, userId: null },
          target: {
            id: commentId,
            organizationId: caller.organizationId,
            postId: comment.value.postId,
          },
        })
        .pipe(withCommentWriteFailures);

      return yield* readWrittenComment({
        commentId,
        organizationId: caller.organizationId,
      });
    })
);

export const unpinCommentOperation = defineOperation(
  "unpinComment",
  {
    description:
      "Unpin a comment; unpinning one that is not pinned is a no-op.",
    failure: COMMENT_MUTATE_FAILURES,
    input: UnpinCommentInput,
    output: PublicApiComment,
    scope: "comments.pin",
  },
  ({ commentId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiCommentRepository;
      const comments = yield* currentCommentService;

      const comment = yield* repository
        .findComment({
          commentId,
          organizationId: caller.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(comment)) {
        return yield* notFoundError("Comment not found.");
      }

      // Unpinning a comment that is not pinned changes nothing, so it is
      // answered with the comment as it stands rather than the failure the
      // write path reports for a row it did not move: a caller retrying a
      // timeout should not have to distinguish "already unpinned" from
      // "gone", and the second is already a 404 above.
      if (comment.value.pinnedAt === null) {
        return toPublicApiComment(comment.value) satisfies TPublicApiComment;
      }

      yield* comments
        .unpin({
          actor: { memberId: null, userId: null },
          target: {
            id: commentId,
            organizationId: caller.organizationId,
            postId: comment.value.postId,
          },
        })
        .pipe(
          // An unpin whose row was released by someone else between the
          // read above and the write is the state this request asks for,
          // not a missing comment: the read below answers with the comment
          // as it stands. A comment that is truly gone still 404s there,
          // because that read fails the same way.
          Effect.catchTag("FailedToUnpinCommentError", () => Effect.void),
          withCommentWriteFailures
        );

      return yield* readWrittenComment({
        commentId,
        organizationId: caller.organizationId,
      });
    })
);

export const commentOperations = [
  listPostCommentsOperation,
  getCommentOperation,
  createCommentOperation,
  updateCommentOperation,
  deleteCommentOperation,
  pinCommentOperation,
  unpinCommentOperation,
] as const;

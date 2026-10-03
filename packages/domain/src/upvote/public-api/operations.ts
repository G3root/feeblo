import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import {
  InvalidSubjectError,
  SubjectNotFoundError,
} from "../../identity/errors";
import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  conflictError,
  internalError,
  invalidRequestError,
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { withRemapDbErrors } from "../../rpc-errors";
import { toPublicApiVote } from "./mappers";
import { currentPublicApiVoteRepository } from "./repository";
import {
  CreateVoteInput,
  DeleteVoteInput,
  ListPostVotesInput,
  PublicApiVote,
  PublicApiVotePage,
  type TPublicApiVote,
} from "./schema";

const VOTE_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/** A create can be refused by the post's state — a locked or merged post. */
const VOTE_CREATE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  InternalError,
]);

/** A delete can miss its row or be refused by the post's state. */
const VOTE_DELETE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  ConflictError,
  InternalError,
]);

/**
 * The shared on-behalf path's failures, answered on the published vocabulary.
 *
 * The identity failures carry the caller's own identifier in their detail, so
 * the published message is fixed: echoing a subject id back would make the
 * error body an existence oracle. Everything else — a lost id-generation race,
 * a subscription write, a driver failure the remap did not name — has no
 * caller-actionable meaning and stays the documented internal failure.
 */
const withVoteWriteFailures = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    withRemapDbErrors("PublicApiVote", "update"),
    Effect.mapError((cause): InvalidRequestError | InternalError => {
      if (Schema.is(InvalidSubjectError)(cause)) {
        return invalidRequestError(
          "The vote's author could not be resolved in this workspace."
        );
      }
      if (Schema.is(SubjectNotFoundError)(cause)) {
        return invalidRequestError(
          "The vote's author could not be found in this workspace."
        );
      }
      return internalError("The request could not be completed.");
    })
  );

/**
 * The vote operations.
 *
 * The writes are the dashboard's own on-behalf path (`upvote/on-behalf.ts`)
 * with a machine-key actor, so an API-added vote lands in the same transaction,
 * the same post timeline, and the same voter subscription as one a member adds
 * from the dashboard. These records are what an MCP tool or a CLI would call;
 * the HTTP endpoints in `./http.ts` only parse the request.
 */

export const listPostVotesOperation = defineOperation(
  "listPostVotes",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List a post's votes, newest first, as a cursor-paginated page. Each vote carries the voter's display identity — a classification and a display name, never an account identifier.",
    failure: VOTE_READ_FAILURES,
    input: ListPostVotesInput,
    output: PublicApiVotePage,
    scope: "votes.read",
  },
  ({ cursor, limit, postId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiVoteRepository;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .listPostVotes({
          cursor: after,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          postId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(page, {
        // Not found rather than an empty page: a post with no votes and a
        // post that does not exist must not look the same, and another
        // workspace's post is reported as missing so the id cannot probe at
        // all.
        onNone: () => Effect.fail(notFoundError("Post not found.")),
        onSome: (found) => {
          return Effect.succeed({
            data: found.votes.map(toPublicApiVote),
            nextCursor:
              found.nextCursor === null ? null : encodeCursor(found.nextCursor),
          });
        },
      });
    })
);

export const createVoteOperation = defineOperation(
  "createVote",
  {
    annotations: { idempotent: true },
    description:
      "Add a vote to a post, attributed to the customer the request names. Adding a vote the same customer already has is a success no-op and returns the existing vote.",
    failure: VOTE_CREATE_FAILURES,
    input: CreateVoteInput,
    output: PublicApiVote,
    scope: "votes.create",
  },
  ({ author, postId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiVoteRepository;

      // The post is read first so a missing post is a 404 and a locked or
      // merged one is the documented conflict, rather than a foreign-key
      // failure the caller cannot act on. The shared on-behalf path performs
      // the mutation; this is the same state gate the dashboard's
      // `canVoteOnBehalf` policy applies.
      const target = yield* repository
        .findVoteTarget({ organizationId: caller.organizationId, postId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(target)) {
        return yield* notFoundError("Post not found.");
      }
      if (target.value.mergedIntoPostId !== null) {
        return yield* conflictError(
          "This post has been merged into another post and cannot be voted on."
        );
      }
      if (target.value.lockedAt !== null) {
        return yield* conflictError(
          "This post is locked and no longer accepts votes."
        );
      }

      const added = yield* repository
        .addVoteOnBehalf({
          organizationId: caller.organizationId,
          postId,
          subject: author,
        })
        .pipe(withVoteWriteFailures);

      // The vote is read back rather than returned from the write: the
      // repository's insert reports whether it added a row, not the row's
      // display fields, and a read is what a later `GET` would perform. A
      // vote that vanishes between the write and the read is answered as the
      // documented internal failure rather than a success with no resource.
      const vote = yield* repository
        .findVoteForUser({
          organizationId: caller.organizationId,
          postId,
          userId: added.userId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(vote, {
        onNone: () =>
          Effect.fail(
            internalError("The vote could not be read after it was recorded.")
          ),
        onSome: (found) =>
          Effect.succeed(toPublicApiVote(found) satisfies TPublicApiVote),
      });
    })
);

export const deleteVoteOperation = defineOperation(
  "deleteVote",
  {
    annotations: { destructive: true },
    description:
      "Remove one vote from a post. A vote that is already gone is reported as not found.",
    failure: VOTE_DELETE_FAILURES,
    input: DeleteVoteInput,
    output: Schema.Void,
    scope: "votes.delete",
  },
  ({ postId, voteId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiVoteRepository;

      const vote = yield* repository
        .findVoteForRemoval({
          organizationId: caller.organizationId,
          postId,
          voteId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(vote)) {
        return yield* notFoundError("Vote not found.");
      }

      // The dashboard refuses to change voters on a locked or merged post, and
      // the public delete is the same act: a post that no longer accepts votes
      // does not have its voters changed through this endpoint either.
      if (vote.value.mergedIntoPostId !== null) {
        return yield* conflictError(
          "This post has been merged into another post and cannot be voted on."
        );
      }
      if (vote.value.lockedAt !== null) {
        return yield* conflictError(
          "This post is locked and no longer accepts votes."
        );
      }

      // The removal is the shared on-behalf path: it deletes exactly this
      // voter's vote and records the same provenance the dashboard records.
      // A row that vanished between the read above and the write is a no-op
      // success, which is what a retried delete should see.
      yield* repository
        .removeVoteOnBehalf({
          organizationId: caller.organizationId,
          postId,
          userId: vote.value.userId,
        })
        .pipe(withVoteWriteFailures);
    })
);

export const voteOperations = [
  listPostVotesOperation,
  createVoteOperation,
  deleteVoteOperation,
] as const;

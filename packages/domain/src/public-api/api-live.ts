import { hasPublicApiScope } from "@feeblo/domain-contracts/public-api-scope";
import { CommentId } from "@feeblo/id";
import { htmlToExcerpt } from "@feeblo/utils/html";
import { sanitizeMarkdown } from "@feeblo/utils/markdown-sanitizer";
import { slugify } from "@feeblo/utils/url";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import {
  type FailedToCreateCommentError,
  type FailedToDeleteCommentError,
  type FailedToPinCommentError,
  type FailedToUnpinCommentError,
  type FailedToUpdateCommentError,
  type PostDoesNotAcceptCommentsError,
} from "../comments/errors";
import { currentCommentService } from "../comments/service";
import { wakeEmailOutboxBestEffort } from "../email-outbox/workflow";
import { InvalidSubjectError, SubjectNotFoundError } from "../identity/errors";
import type { OnBehalfSubject } from "../identity/service";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import { PublicApi } from "./api-contract";
import { currentPublicApiConfig } from "./config";
import { decodeCursor, encodeCursor } from "./cursor";
import { requireCrmEntryAllowance } from "./entitlement";
import {
  conflictError,
  internalError,
  invalidRequestError,
  notFoundError,
} from "./errors";
import {
  toPublicApiChangelog,
  toPublicApiChangelogSummary,
  toPublicApiComment,
  toPublicApiCompany,
  toPublicApiPost,
  toPublicApiPostSummary,
  toPublicApiTag,
  toPublicApiTagDetail,
} from "./mappers";
import { currentPublicApiCaller, requirePublicApiScope } from "./middleware";
import { currentPublicApiRepository } from "./repository";
import {
  PUBLIC_API_PAGE_DEFAULT_LIMIT,
  PUBLIC_API_PAGE_MAX_LIMIT,
  PublicApiChangelogStatus,
  type TPublicApiChangelog,
  type TPublicApiChangelogPage,
  type TPublicApiChangelogStatus,
  type TPublicApiComment,
  type TPublicApiCommentAuthorSubject,
  type TPublicApiCommentPage,
  type TPublicApiCompanyPage,
  type TPublicApiPost,
  type TPublicApiPostPage,
  type TPublicApiPostTags,
  type TPublicApiTagPage,
} from "./schema";

const parseLimit = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return PUBLIC_API_PAGE_DEFAULT_LIMIT;
    }

    if (!/^\d+$/.test(raw)) {
      return yield* Effect.fail(
        invalidRequestError("limit must be a positive integer.")
      );
    }

    const limit = Number(raw);
    if (limit < 1 || limit > PUBLIC_API_PAGE_MAX_LIMIT) {
      return yield* Effect.fail(
        invalidRequestError(
          `limit must be between 1 and ${PUBLIC_API_PAGE_MAX_LIMIT}.`
        )
      );
    }

    return limit;
  });

const parseIncludeArchived = (raw: string | undefined) => {
  if (raw === undefined || raw.length === 0 || raw === "false") {
    return Effect.succeed(false);
  }
  if (raw === "true") {
    return Effect.succeed(true);
  }
  return Effect.fail(
    invalidRequestError("includeArchived must be true or false.")
  );
};

/**
 * Decodes the cursor, distinguishing "no cursor" from "a cursor I cannot read".
 *
 * Ignoring an unreadable cursor would silently return the first page forever,
 * so it is reported as `INVALID_REQUEST` instead.
 */
const parseCursor = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return null;
    }

    const decoded = Option.getOrNull(decodeCursor(raw));
    if (decoded === null) {
      return yield* Effect.fail(
        invalidRequestError("cursor is not a valid page cursor.")
      );
    }

    return decoded;
  });

/**
 * Tag and company names are trimmed before they are stored or compared.
 *
 * Without this, `" UI "` and `"UI"` are two different names that produce the
 * same tag slug, so the second one is rejected by an index the caller cannot
 * see; and a company named `" Acme "` would sit beside `"Acme"` until someone
 * looked. An all-whitespace name is not a name at all.
 */
const parseName = (raw: string) =>
  Effect.gen(function* () {
    const name = raw.trim();
    if (name.length === 0) {
      return yield* Effect.fail(invalidRequestError("name must not be empty."));
    }
    return name;
  });

/**
 * Post titles are trimmed before they are stored or slugified.
 *
 * Without this, `" Dark mode "` and `"Dark mode"` are two titles whose slugs
 * are one, and an all-whitespace title is not a title at all. The dashboard's
 * own title schema trims for the same reason.
 */
const parseTitle = (raw: string) =>
  Effect.gen(function* () {
    const title = raw.trim();
    if (title.length === 0) {
      return yield* Effect.fail(
        invalidRequestError("title must not be empty.")
      );
    }
    return title;
  });

/**
 * A query parameter that names something.
 *
 * Absent, blank, and whitespace-only are all "not provided", so `?id=` does
 * not become a lookup for the empty string and cannot be used to probe what an
 * empty identifier would match. Query parameters are declared as strings and
 * validated here for the same reason the rest of the API does it: the
 * framework's own decode failure is not this API's error envelope.
 */
const providedQueryParam = (raw: string | undefined) => {
  const trimmed = raw?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

/** The same message for both the pre-check and the index race that beats it. */
const TAG_NAME_CONFLICT = "A tag with this name already exists.";

/**
 * The pre-check's messages, one per colliding field.
 *
 * The index race that beats the pre-check is reported by the repository
 * instead, which cannot say which of the two indexes was violated — see
 * `COMPANY_UNIQUE_VIOLATION_MESSAGE`.
 */
const COMPANY_NAME_CONFLICT = "A company with this name already exists.";

const COMPANY_EXTERNAL_ID_CONFLICT =
  "A company with this externalId already exists.";

/**
 * The `status` filter on the changelog list, or nothing for every status.
 *
 * Declared as a string in the query schema and decoded here, so a typo is the
 * documented `INVALID_REQUEST` rather than a page that silently looks empty.
 */
const parseChangelogStatusFilter = (raw: string | undefined) =>
  Effect.gen(function* () {
    if (raw === undefined || raw.length === 0) {
      return null;
    }

    const decoded = Schema.decodeUnknownOption(PublicApiChangelogStatus)(raw);
    if (Option.isNone(decoded)) {
      return yield* Effect.fail(
        invalidRequestError("status must be draft, scheduled, or published.")
      );
    }

    return decoded.value;
  });

/**
 * The write fields both the create and the update share, normalized.
 *
 * The title is trimmed because it is stored and slugified, and a trailing
 * space that survives into a slug is a URL a reader cannot type back. The slug
 * is always the one `slugify` produced, from the supplied value or the title,
 * so `UI Kit` and `ui-kit` cannot become two entries that look identical in a
 * feed. The timestamps are only validated against the status that selects
 * them: a publish that carried no `publishedAt` would have the server invent a
 * date that decides an ordering readers see, and a schedule with no
 * `scheduledAt` says nothing at all.
 */
const parseChangelogWrite = (write: {
  readonly content: string;
  readonly coverImage?: string | null | undefined;
  readonly publishedAt?: Date | null | undefined;
  readonly scheduledAt?: Date | null | undefined;
  readonly slug?: string | undefined;
  readonly status: TPublicApiChangelogStatus;
  readonly title: string;
}) =>
  Effect.gen(function* () {
    const title = write.title.trim();
    if (title.length === 0) {
      return yield* Effect.fail(
        invalidRequestError("title must not be empty.")
      );
    }

    const slug = slugify((write.slug ?? "").trim() || title);
    if (slug.length === 0) {
      return yield* Effect.fail(
        invalidRequestError("slug must contain at least one letter or number.")
      );
    }

    if (write.status === "published" && write.publishedAt == null) {
      return yield* Effect.fail(
        invalidRequestError("publishedAt is required when status is published.")
      );
    }

    if (write.status === "scheduled" && write.scheduledAt == null) {
      return yield* Effect.fail(
        invalidRequestError("scheduledAt is required when status is scheduled.")
      );
    }

    return {
      content: write.content,
      coverImage: write.coverImage ?? null,
      publishedAt: write.publishedAt ?? null,
      scheduledAt: write.scheduledAt ?? null,
      slug,
      status: write.status,
      title,
    };
  });

/**
 * The repository's driver failure, answered on the published vocabulary.
 *
 * `withRemapDbErrors` turns a driver failure into the domain's
 * `InternalServerError`; the code a caller switches on is this API's own
 * `INTERNAL_ERROR`, so renaming an internal error cannot change the published
 * body. The message is fixed for the same reason — a driver message can carry
 * a constraint name or a row.
 */
const onInternalError = () =>
  Effect.fail(internalError("The request could not be completed."));

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
  FailedToCreateCommentError: () => onInternalError(),
  FailedToDeleteCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  FailedToPinCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  FailedToUnpinCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  FailedToUpdateCommentError: () =>
    Effect.fail(notFoundError("Comment not found.")),
  InternalServerError: () => onInternalError(),
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
    CommentWriteFailure | PostDoesNotAcceptCommentsError,
    R
  >
) =>
  effect.pipe(
    Effect.catchTags({
      ...commentWriteFailureHandlers,
      PostDoesNotAcceptCommentsError: (error: PostDoesNotAcceptCommentsError) =>
        Effect.fail(conflictError(error.message)),
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
    const repository = yield* currentPublicApiRepository;
    const found = yield* repository
      .findComment(args)
      .pipe(Effect.catchTag("InternalServerError", onInternalError));

    return yield* Option.match(found, {
      onNone: () => Effect.fail(notFoundError("Comment not found.")),
      onSome: (comment) =>
        Effect.succeed(toPublicApiComment(comment) satisfies TPublicApiComment),
    });
  });

/**
 * Rejects a name another tag in the workspace already holds.
 *
 * A courtesy to the caller, not the authority: the unique index is, and the
 * repository maps its violation to the same conflict. Checking first means an
 * ordinary duplicate is answered with a message about the name rather than a
 * driver error the caller cannot act on. `excludeTagId` is what lets a tag
 * keep its own name through a rename.
 */
const failIfTagNameIsTaken = (args: {
  readonly excludeTagId: string | null;
  readonly name: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* currentPublicApiRepository;
    const existing = yield* repository
      .findTagNameConflict(args)
      .pipe(Effect.catchTag("InternalServerError", onInternalError));

    if (Option.isSome(existing)) {
      return yield* Effect.fail(conflictError(TAG_NAME_CONFLICT));
    }
  });

/**
 * Rejects a name, or an external id, another company in the workspace holds.
 *
 * A courtesy to the caller, not the authority: the two unique indexes are, and
 * the repository maps their violation to the same conflict. Checking first
 * means an ordinary duplicate is answered with a message about the field that
 * actually collided, which is the difference between "rename it" and "that
 * sync id is already in use" for a caller that has to decide what to do next.
 *
 * `excludeCompanyId` is what lets a company keep its own name and its own
 * external id through an update. A name or external id that is not being
 * written is `null` and is never checked; `externalId` is nullable, and
 * Postgres treats `NULL` as distinct in a unique index, so two companies may
 * both leave it unset.
 */
const failIfCompanyIsTaken = (args: {
  readonly excludeCompanyId: string | null;
  /** The external id the write would store, or null when it is not changing. */
  readonly externalId: string | null;
  /** The name the write would store, or null when it is not changing. */
  readonly name: string | null;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const repository = yield* currentPublicApiRepository;

    if (args.name !== null) {
      const nameTaken = yield* repository
        .findCompanyNameConflict({
          excludeCompanyId: args.excludeCompanyId,
          name: args.name,
          organizationId: args.organizationId,
        })
        .pipe(Effect.catchTag("InternalServerError", onInternalError));

      if (Option.isSome(nameTaken)) {
        return yield* Effect.fail(conflictError(COMPANY_NAME_CONFLICT));
      }
    }

    if (args.externalId === null) {
      return;
    }

    const externalIdTaken = yield* repository
      .findCompanyExternalIdConflict({
        excludeCompanyId: args.excludeCompanyId,
        externalId: args.externalId,
        organizationId: args.organizationId,
      })
      .pipe(Effect.catchTag("InternalServerError", onInternalError));

    if (Option.isSome(externalIdTaken)) {
      return yield* Effect.fail(conflictError(COMPANY_EXTERNAL_ID_CONFLICT));
    }
  });

export const PublicApiLive = HttpApiBuilder.group(
  PublicApi,
  "PublicApiV1",
  (handlers) =>
    handlers
      .handle("listBoardPosts", ({ params, query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);
          const includeArchived = yield* parseIncludeArchived(
            query.includeArchived
          );

          const page = yield* repository
            .listBoardPosts({
              boardId: params.boardId,
              cursor,
              includeArchived,
              limit,
              organizationId: caller.organizationId,
              statusId: query.status ?? null,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(page, {
            // Not found rather than an empty page: a missing board and an
            // empty board must not look the same, and another workspace's
            // board is reported as missing so the id cannot probe at all.
            onNone: () => Effect.fail(notFoundError("Board not found.")),
            onSome: (found) => {
              const mapperContext = {
                appUrl: config.appUrl,
                organizationId: caller.organizationId,
              } as const;

              return Effect.succeed({
                data: found.posts.map((post) =>
                  toPublicApiPostSummary(post, mapperContext)
                ),
                nextCursor:
                  found.nextCursor === null
                    ? null
                    : encodeCursor(found.nextCursor),
              } satisfies TPublicApiPostPage);
            },
          });
        })
      )
      .handle("getPost", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.read");

          const post = yield* repository
            .findPost({
              organizationId: caller.organizationId,
              postId: params.postId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(post, {
            // Not found rather than forbidden for another workspace's post: a
            // 403 would confirm that the id exists somewhere.
            onNone: () => Effect.fail(notFoundError("Post not found.")),
            onSome: (found) =>
              Effect.succeed(
                toPublicApiPost(found, {
                  appUrl: config.appUrl,
                  organizationId: caller.organizationId,
                }) satisfies TPublicApiPost
              ),
          });
        })
      )
      .handle("listPosts", ({ query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);
          const includeArchived = yield* parseIncludeArchived(
            query.includeArchived
          );

          // No existence check: the key proves the workspace exists, and a
          // workspace with no posts is an empty page rather than a 404.
          const page = yield* repository
            .listPosts({
              cursor,
              includeArchived,
              limit,
              organizationId: caller.organizationId,
              statusId: query.status ?? null,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          const mapperContext = {
            appUrl: config.appUrl,
            organizationId: caller.organizationId,
          } as const;

          return {
            data: page.posts.map((post) =>
              toPublicApiPostSummary(post, mapperContext)
            ),
            nextCursor:
              page.nextCursor === null ? null : encodeCursor(page.nextCursor),
          } satisfies TPublicApiPostPage;
        })
      )
      .handle("retrievePost", ({ query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.read");

          const postId = providedQueryParam(query.id);
          const boardId = providedQueryParam(query.boardId);
          const slug = providedQueryParam(query.slug);

          if (postId === undefined && slug === undefined) {
            return yield* Effect.fail(
              invalidRequestError(
                "Provide a post id, or a boardId and a slug, to retrieve a post."
              )
            );
          }

          // A slug only means something next to a board: matching one against
          // every board would let a caller read a post by a name it did not
          // know the board of, which is not what the parameter is for.
          if (slug !== undefined && boardId === undefined) {
            return yield* Effect.fail(
              invalidRequestError(
                "boardId is required when a slug is provided."
              )
            );
          }

          // Every identifier present must match, so an id paired with the
          // wrong board is answered as not found rather than silently returned.
          const post = yield* repository
            .retrievePost({
              boardId,
              organizationId: caller.organizationId,
              postId,
              slug,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(post, {
            // Not found rather than forbidden for another workspace's post: a
            // 403 would confirm that the id exists somewhere.
            onNone: () => Effect.fail(notFoundError("Post not found.")),
            onSome: (found) =>
              Effect.succeed(
                toPublicApiPost(found, {
                  appUrl: config.appUrl,
                  organizationId: caller.organizationId,
                }) satisfies TPublicApiPost
              ),
          });
        })
      )
      .handle("createPost", ({ payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.create");

          const title = yield* parseTitle(payload.title);

          const created = yield* repository.createPost({
            boardId: payload.boardId,
            content: payload.content,
            etaQuarter: payload.etaQuarter ?? null,
            organizationId: caller.organizationId,
            statusId: payload.statusId,
            title,
          });

          return toPublicApiPost(created, {
            appUrl: config.appUrl,
            organizationId: caller.organizationId,
          }) satisfies TPublicApiPost;
        })
      )
      .handle("updatePost", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const config = yield* currentPublicApiConfig;

          yield* requirePublicApiScope("posts.update");

          // A body that names no field would otherwise be answered as a
          // successful write that changed nothing but `updatedAt`, which
          // tells the caller their request did something it did not. `null`
          // is a field being named, so a body that only clears an ETA is fine.
          const namesAField =
            payload.title !== undefined ||
            payload.content !== undefined ||
            payload.statusId !== undefined ||
            payload.boardId !== undefined ||
            payload.etaQuarter !== undefined;

          if (!namesAField) {
            return yield* Effect.fail(
              invalidRequestError("Provide at least one field to update.")
            );
          }

          const title =
            payload.title === undefined
              ? undefined
              : yield* parseTitle(payload.title);

          const updated = yield* repository.updatePost({
            boardId: payload.boardId,
            content: payload.content,
            etaQuarter: payload.etaQuarter,
            organizationId: caller.organizationId,
            postId: params.postId,
            statusId: payload.statusId,
            title,
          });

          // The update itself fails with `NOT_FOUND` for a post that is not
          // there; this covers the row vanishing between the write and the
          // read-back, which the write cannot prevent.
          return yield* Option.match(updated, {
            onNone: () => Effect.fail(notFoundError("Post not found.")),
            onSome: (post) =>
              Effect.succeed(
                toPublicApiPost(post, {
                  appUrl: config.appUrl,
                  organizationId: caller.organizationId,
                }) satisfies TPublicApiPost
              ),
          });
        })
      )
      .handle("deletePost", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("posts.delete");

          yield* repository.deletePost({
            organizationId: caller.organizationId,
            postId: params.postId,
          });
        })
      )
      .handle("setPostTags", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.assign");

          // The post is read and locked inside the write's own transaction, so
          // another workspace's post is a 404, a post deleted mid-request is a
          // 404 rather than a foreign-key failure, and two replacements of one
          // post's tags cannot interleave into a set neither caller asked for.
          const tags = yield* repository
            .setPostTags({
              organizationId: caller.organizationId,
              postId: params.postId,
              tagIds: payload.tagIds,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: tags.map(toPublicApiTag),
          } satisfies TPublicApiPostTags;
        })
      )
      .handle("listPostComments", ({ params, query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("comments.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);

          const page = yield* repository
            .listPostComments({
              cursor,
              limit,
              organizationId: caller.organizationId,
              postId: params.postId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

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
                  found.nextCursor === null
                    ? null
                    : encodeCursor(found.nextCursor),
              } satisfies TPublicApiCommentPage),
          });
        })
      )
      .handle("getComment", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("comments.read");

          const comment = yield* repository
            .findComment({
              commentId: params.commentId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(comment, {
            onNone: () => Effect.fail(notFoundError("Comment not found.")),
            onSome: (found) =>
              Effect.succeed(
                toPublicApiComment(found) satisfies TPublicApiComment
              ),
          });
        })
      )
      .handle("createComment", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const comments = yield* currentCommentService;

          yield* requirePublicApiScope("comments.create");

          const target = yield* repository
            .findCommentTarget({
              organizationId: caller.organizationId,
              postId: params.postId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(target)) {
            return yield* Effect.fail(notFoundError("Post not found."));
          }

          const commentId = yield* CommentId.generate.pipe(
            Effect.catchTag("LegidError", onInternalError)
          );

          yield* comments
            .create({
              // A machine key is not a member: the timeline records no actor,
              // and the comment is authored by the customer the request names
              // because there is no session user to author it.
              actor: { memberId: null, userId: null },
              author: {
                kind: "on_behalf",
                subject: toOnBehalfSubject(payload.author),
              },
              draft: {
                content: payload.content,
                id: commentId,
                organizationId: caller.organizationId,
                parentCommentId: payload.parentCommentId ?? null,
                postId: params.postId,
                visibility: payload.visibility ?? "PUBLIC",
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
      )
      .handle("updateComment", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const comments = yield* currentCommentService;

          yield* requirePublicApiScope("comments.update");

          // Read first so another workspace's comment is a 404 rather than an
          // update that matches no row and answers 200. The post id comes from
          // the read because the write path scopes its predicate by it.
          const comment = yield* repository
            .findComment({
              commentId: params.commentId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(comment)) {
            return yield* Effect.fail(notFoundError("Comment not found."));
          }

          yield* comments
            .update({
              actor: { memberId: null, userId: null },
              edit: {
                content: payload.content,
                id: params.commentId,
                organizationId: caller.organizationId,
                postId: comment.value.postId,
                visibility: payload.visibility,
              },
            })
            .pipe(withCommentWriteFailures);

          return yield* readWrittenComment({
            commentId: params.commentId,
            organizationId: caller.organizationId,
          });
        })
      )
      .handle("deleteComment", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const comments = yield* currentCommentService;

          yield* requirePublicApiScope("comments.delete");

          // A comment that is already gone is a 404 rather than a success: the
          // caller cannot tell a delete that worked from one that named the
          // wrong workspace, and the second is worth knowing.
          const comment = yield* repository
            .findComment({
              commentId: params.commentId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(comment)) {
            return yield* Effect.fail(notFoundError("Comment not found."));
          }

          yield* comments
            .remove({
              actor: { memberId: null, userId: null },
              target: {
                id: params.commentId,
                organizationId: caller.organizationId,
                postId: comment.value.postId,
              },
            })
            .pipe(withCommentWriteFailures);
        })
      )
      .handle("pinComment", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const comments = yield* currentCommentService;

          yield* requirePublicApiScope("comments.pin");

          const comment = yield* repository
            .findComment({
              commentId: params.commentId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(comment)) {
            return yield* Effect.fail(notFoundError("Comment not found."));
          }

          yield* comments
            .pin({
              actor: { memberId: null, userId: null },
              target: {
                id: params.commentId,
                organizationId: caller.organizationId,
                postId: comment.value.postId,
              },
            })
            .pipe(withCommentWriteFailures);

          return yield* readWrittenComment({
            commentId: params.commentId,
            organizationId: caller.organizationId,
          });
        })
      )
      .handle("unpinComment", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;
          const comments = yield* currentCommentService;

          yield* requirePublicApiScope("comments.pin");

          const comment = yield* repository
            .findComment({
              commentId: params.commentId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(comment)) {
            return yield* Effect.fail(notFoundError("Comment not found."));
          }

          // Unpinning a comment that is not pinned changes nothing, so it is
          // answered with the comment as it stands rather than the failure the
          // write path reports for a row it did not move: a caller retrying a
          // timeout should not have to distinguish "already unpinned" from
          // "gone", and the second is already a 404 above.
          if (comment.value.pinnedAt === null) {
            return toPublicApiComment(
              comment.value
            ) satisfies TPublicApiComment;
          }

          yield* comments
            .unpin({
              actor: { memberId: null, userId: null },
              target: {
                id: params.commentId,
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
            commentId: params.commentId,
            organizationId: caller.organizationId,
          });
        })
      )
      .handle("listTags", ({ query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);

          // No existence check: the key proves the workspace exists, and a
          // workspace with no tags is an empty page rather than a 404.
          const page = yield* repository
            .listTags({
              cursor,
              limit,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: page.tags.map(toPublicApiTagDetail),
            nextCursor:
              page.nextCursor === null ? null : encodeCursor(page.nextCursor),
          } satisfies TPublicApiTagPage;
        })
      )
      .handle("createTag", ({ payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.create");

          const name = yield* parseName(payload.name);

          yield* failIfTagNameIsTaken({
            excludeTagId: null,
            name,
            organizationId: caller.organizationId,
          });

          const created = yield* repository
            .createTag({ name, organizationId: caller.organizationId })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return toPublicApiTagDetail(created);
        })
      )
      .handle("getTag", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.read");

          const tag = yield* repository
            .findTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(tag, {
            onNone: () => Effect.fail(notFoundError("Tag not found.")),
            onSome: (found) => Effect.succeed(toPublicApiTagDetail(found)),
          });
        })
      )
      .handle("updateTag", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.update");

          const name = yield* parseName(payload.name);

          // The tag is read before the rename so another workspace's tag is a
          // 404 rather than an update that matches no row and answers 200.
          const tag = yield* repository
            .findTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(tag)) {
            return yield* Effect.fail(notFoundError("Tag not found."));
          }

          yield* failIfTagNameIsTaken({
            excludeTagId: params.tagId,
            name,
            organizationId: caller.organizationId,
          });

          const updated = yield* repository
            .updateTag({
              name,
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return toPublicApiTagDetail(updated);
        })
      )
      .handle("deleteTag", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.delete");

          // Deleting a tag that is already gone is a 404 rather than a
          // success: the caller cannot tell a delete that worked from one
          // that named the wrong workspace, and the second is worth knowing.
          const tag = yield* repository
            .findTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(tag)) {
            return yield* Effect.fail(notFoundError("Tag not found."));
          }

          yield* repository
            .deleteTag({
              organizationId: caller.organizationId,
              tagId: params.tagId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));
        })
      )
      .handle("listCompanies", ({ query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);

          // No existence check: the key proves the workspace exists, and a
          // workspace with no companies is an empty page rather than a 404.
          const page = yield* repository
            .listCompanies({
              cursor,
              limit,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: page.companies.map(toPublicApiCompany),
            nextCursor:
              page.nextCursor === null ? null : encodeCursor(page.nextCursor),
          } satisfies TPublicApiCompanyPage;
        })
      )
      .handle("createCompany", ({ payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.create");

          const name = yield* parseName(payload.name);

          yield* failIfCompanyIsTaken({
            excludeCompanyId: null,
            externalId: payload.externalId ?? null,
            name,
            organizationId: caller.organizationId,
          });

          // The plan gate and the insert are one call, and one transaction: the
          // repository locks the workspace, runs this check, and only then
          // writes, so two creates arriving near a plan's cap cannot both see
          // room. See `createCompany`.
          const created = yield* repository
            .createCompany({
              avatar: payload.avatar ?? null,
              ensureRoom: requireCrmEntryAllowance(caller.organizationId),
              externalCreatedAt: payload.externalCreatedAt ?? null,
              externalId: payload.externalId ?? null,
              name,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return toPublicApiCompany(created);
        })
      )
      .handle("getCompany", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.read");

          const company = yield* repository
            .findCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(company, {
            onNone: () => Effect.fail(notFoundError("Company not found.")),
            onSome: (found) => Effect.succeed(toPublicApiCompany(found)),
          });
        })
      )
      .handle("updateCompany", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.update");

          // A body that names no field would otherwise be answered as a
          // successful write that changed nothing but `updatedAt`, which tells
          // the caller their request did something it did not. `null` is a
          // field being named, so a body that only clears an avatar is fine.
          const namesAField =
            payload.name !== undefined ||
            payload.externalId !== undefined ||
            payload.avatar !== undefined ||
            payload.externalCreatedAt !== undefined;

          if (!namesAField) {
            return yield* Effect.fail(
              invalidRequestError("Provide at least one field to update.")
            );
          }

          const name =
            payload.name === undefined ? null : yield* parseName(payload.name);

          // The company is read before the write so another workspace's
          // company is a 404 rather than an update that matches no row and
          // answers 200.
          const company = yield* repository
            .findCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(company)) {
            return yield* Effect.fail(notFoundError("Company not found."));
          }

          yield* failIfCompanyIsTaken({
            excludeCompanyId: params.companyId,
            externalId: payload.externalId ?? null,
            name,
            organizationId: caller.organizationId,
          });

          const updated = yield* repository
            .updateCompany({
              avatar: payload.avatar,
              companyId: params.companyId,
              externalCreatedAt: payload.externalCreatedAt,
              externalId: payload.externalId,
              // `null` means "not being written"; the repository's `undefined`
              // is what leaves the column alone.
              name: name ?? undefined,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          // The read above cannot hold the row still, so a company deleted
          // between the two is answered as the missing company it is rather
          // than as a driver failure the caller cannot act on.
          return yield* Option.match(updated, {
            onNone: () => Effect.fail(notFoundError("Company not found.")),
            onSome: (company) => Effect.succeed(toPublicApiCompany(company)),
          });
        })
      )
      .handle("deleteCompany", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("companies.delete");

          // A company that is already gone is a 404 rather than a success, for
          // the same reason as a tag: the caller cannot tell a delete that
          // worked from one that named the wrong workspace.
          const company = yield* repository
            .findCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(company)) {
            return yield* Effect.fail(notFoundError("Company not found."));
          }

          const deleted = yield* repository
            .deleteCompany({
              companyId: params.companyId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          // The read above cannot hold the row still, so a company deleted
          // between the two is answered as the missing company it is rather
          // than as a success that deleted nothing.
          if (!deleted) {
            return yield* Effect.fail(notFoundError("Company not found."));
          }
        })
      )
      .handle("listChangelog", ({ query }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("changelog.read");

          const limit = yield* parseLimit(query.limit);
          const cursor = yield* parseCursor(query.cursor);
          const status = yield* parseChangelogStatusFilter(query.status);

          const page = yield* repository
            .listChangelog({
              cursor,
              limit,
              organizationId: caller.organizationId,
              status,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: page.entries.map(toPublicApiChangelogSummary),
            nextCursor:
              page.nextCursor === null ? null : encodeCursor(page.nextCursor),
          } satisfies TPublicApiChangelogPage;
        })
      )
      .handle("getChangelog", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("changelog.read");

          const entry = yield* repository
            .findChangelog({
              changelogId: params.changelogId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return yield* Option.match(entry, {
            // Not found rather than forbidden for another workspace's entry: a
            // 403 would confirm that the id exists somewhere.
            onNone: () =>
              Effect.fail(notFoundError("Changelog entry not found.")),
            onSome: (found) =>
              Effect.succeed(
                toPublicApiChangelog(found) satisfies TPublicApiChangelog
              ),
          });
        })
      )
      .handle("createChangelog", ({ payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("changelog.create");

          const write = yield* parseChangelogWrite({
            ...payload,
            status: payload.status ?? "draft",
          });
          const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
            write.content
          );

          // The publish scope travels into the write rather than being
          // required here: a create that starts as a draft does not need it,
          // and only the write knows whether the request publishes.
          const created = yield* repository
            .createChangelog({
              ...write,
              allowPublish: hasPublicApiScope(
                caller.scopes,
                "changelog.publish"
              ),
              content: sanitizedMarkdown,
              excerpt: htmlToExcerpt(sanitizedHtml),
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          // After the commit, best-effort: the intent is already durable, so a
          // wake that fails costs latency, not the email, and reconciliation
          // picks it up.
          yield* wakeEmailOutboxBestEffort(
            created.outboxId,
            caller.organizationId
          );

          return toPublicApiChangelog(created.entry);
        })
      )
      .handle("updateChangelog", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("changelog.update");

          const write = yield* parseChangelogWrite(payload);
          const { sanitizedMarkdown, sanitizedHtml } = sanitizeMarkdown(
            write.content
          );

          // A `published` update that is not a transition is an ordinary edit
          // of an already-published entry and does not need `changelog.publish`;
          // the write decides from the locked status, so a race cannot turn a
          // draft into a broadcast for a key that never held the scope.
          const updated = yield* repository
            .updateChangelog({
              ...write,
              allowPublish: hasPublicApiScope(
                caller.scopes,
                "changelog.publish"
              ),
              changelogId: params.changelogId,
              content: sanitizedMarkdown,
              excerpt: htmlToExcerpt(sanitizedHtml),
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          yield* wakeEmailOutboxBestEffort(
            updated.outboxId,
            caller.organizationId
          );

          return toPublicApiChangelog(updated.entry);
        })
      )
      .handle("deleteChangelog", ({ params }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("changelog.delete");

          // A delete that matches no row is a 404 rather than a success: the
          // caller cannot tell a delete that worked from one that named the
          // wrong workspace, and the second is worth knowing.
          const deleted = yield* repository
            .deleteChangelog({
              changelogId: params.changelogId,
              organizationId: caller.organizationId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (!deleted) {
            return yield* Effect.fail(
              notFoundError("Changelog entry not found.")
            );
          }
        })
      )
);

import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { PublicApi } from "./api-contract";
import { currentPublicApiConfig } from "./config";
import { decodeCursor, encodeCursor } from "./cursor";
import {
  conflictError,
  internalError,
  invalidRequestError,
  notFoundError,
} from "./errors";
import {
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
 * Tag names are trimmed before they are stored or compared.
 *
 * Without this, `" UI "` and `"UI"` are two different names that produce the
 * same slug, so the second one is rejected by an index the caller cannot see.
 * An all-whitespace name is not a name at all.
 */
const parseTagName = (raw: string) =>
  Effect.gen(function* () {
    const name = raw.trim();
    if (name.length === 0) {
      return yield* Effect.fail(invalidRequestError("name must not be empty."));
    }
    return name;
  });

/** The same message for both the pre-check and the index race that beats it. */
const TAG_NAME_CONFLICT = "A tag with this name already exists.";

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
 * Rejects a tag set that names a tag the workspace does not have.
 *
 * Ignoring an unknown id would tag the post with the ids that happen to exist
 * and answer 200, so a caller that mistyped one id would see a success and a
 * post that is not tagged the way it asked. The count is compared rather than
 * the ids reported, so the endpoint cannot be used to test whether a tag id
 * exists in a workspace the key cannot read.
 */
const failIfTagsAreUnknown = (args: {
  readonly organizationId: string;
  readonly tagIds: readonly string[];
}) =>
  Effect.gen(function* () {
    const repository = yield* currentPublicApiRepository;
    const found = yield* repository
      .countExistingTags(args)
      .pipe(Effect.catchTag("InternalServerError", onInternalError));

    if (found !== args.tagIds.length) {
      return yield* Effect.fail(
        invalidRequestError(
          "One or more tagIds do not exist in this workspace."
        )
      );
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
      .handle("setPostTags", ({ params, payload }) =>
        Effect.gen(function* () {
          const caller = yield* currentPublicApiCaller;
          const repository = yield* currentPublicApiRepository;

          yield* requirePublicApiScope("tags.assign");

          // The post is read before the write so another workspace's post is a
          // 404 rather than a set that tags nothing and answers 200.
          const post = yield* repository
            .findPost({
              organizationId: caller.organizationId,
              postId: params.postId,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          if (Option.isNone(post)) {
            return yield* Effect.fail(notFoundError("Post not found."));
          }

          // Deduplicated before the check: the count compares distinct rows,
          // so the same id twice would otherwise look like a tag the workspace
          // does not have.
          const tagIds = [...new Set(payload.tagIds)];
          yield* failIfTagsAreUnknown({
            organizationId: caller.organizationId,
            tagIds,
          });

          const tags = yield* repository
            .setPostTags({
              organizationId: caller.organizationId,
              postId: params.postId,
              tagIds,
            })
            .pipe(Effect.catchTag("InternalServerError", onInternalError));

          return {
            data: tags.map(toPublicApiTag),
          } satisfies TPublicApiPostTags;
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

          const name = yield* parseTagName(payload.name);

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

          const name = yield* parseTagName(payload.name);

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
);

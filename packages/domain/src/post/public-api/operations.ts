import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { currentPostActivityRepository } from "../../post-activity/repository";
import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { currentPublicApiConfig } from "../../public-api/config";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
import { currentPublicApiDatabase } from "../../public-api/database";
import {
  ConflictError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
  invalidRequestError,
  notFoundError,
} from "../../public-api/errors";
import { onInternalError } from "../../public-api/failure";
import { currentPublicApiCaller } from "../../public-api/middleware";
import { defineOperation } from "../../public-api/operation";
import { parseTitle, parseUpdatedAfter } from "../../public-api/parse";
import { withRemapDbErrors } from "../../rpc-errors";
import { postTagChangeActivities } from "../../tag/post-tag-activities";
import { toPublicApiTag } from "../../tag/public-api/mappers";
import { currentTagRepository } from "../../tag/repository";
import {
  toActivitySource,
  toPublicApiPost,
  toPublicApiPostActivity,
  toPublicApiPostSummary,
} from "./mappers";
import { currentPublicApiPostRepository } from "./repository";
import {
  CreatePostInput,
  DeletePostInput,
  GetPostInput,
  ListBoardPostsInput,
  ListPostActivityInput,
  ListPostsInput,
  PublicApiPost,
  PublicApiPostActivityPage,
  PublicApiPostPage,
  PublicApiPostTags,
  RetrievePostInput,
  SetPostTagsInput,
  UpdatePostInput,
} from "./schema";

const POST_READ_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/** A create can collide on a slug, but cannot report a missing row. */
const POST_CREATE_FAILURES = Schema.Union([
  InvalidRequestError,
  ConflictError,
  InternalError,
]);

const POST_WRITE_FAILURES = Schema.Union([
  InvalidRequestError,
  NotFoundError,
  InternalError,
]);

/**
 * A query parameter that names something.
 *
 * Absent, blank, and whitespace-only are all "not provided", so `?id=` does
 * not become a lookup for the empty string and cannot be used to probe what an
 * empty identifier would match. The HTTP handler trims before it calls; an MCP
 * caller's typed input is already exact.
 */
const provided = (value: string | undefined) => {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
};

/**
 * The post operations.
 *
 * The post writes are the dashboard's shared write path with an `api_key`
 * actor (`post/write.ts`), so an API-created post lands in the same timeline,
 * the same integration events, and the same notification fan-out as one
 * submitted through the dashboard. Setting a post's tags is `TagRepository`'s
 * own replacement, recorded on the post's timeline with no actor — a machine
 * key is not a member.
 */

export const listBoardPostsOperation = defineOperation(
  "listBoardPosts",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List one board's posts, newest first, optionally filtered by status, tag, or change time.",
    failure: POST_READ_FAILURES,
    input: ListBoardPostsInput,
    output: PublicApiPostPage,
    scope: "posts.read",
  },
  ({
    boardId,
    cursor,
    includeArchived,
    limit,
    statusId,
    tagIds,
    updatedAfter,
  }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const after = yield* decodeCursorOrFail(cursor);
      // Parsed here rather than in the HTTP handler, so the MCP projection of
      // this operation validates the same way: the two surfaces cannot answer
      // differently for the same value, and a day that does not exist cannot
      // be rolled over on one of them.
      const changedAfter = yield* parseUpdatedAfter(updatedAfter);

      const page = yield* repository
        .listBoardPosts({
          boardId,
          cursor: after,
          includeArchived: includeArchived ?? false,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          statusId: statusId ?? null,
          tagIds: tagIds ?? null,
          updatedAfter: changedAfter,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

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
              found.nextCursor === null ? null : encodeCursor(found.nextCursor),
          });
        },
      });
    })
);

export const listPostsOperation = defineOperation(
  "listPosts",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List the workspace's posts, newest first, optionally filtered by board, status, tag, or change time.",
    failure: POST_READ_FAILURES,
    input: ListPostsInput,
    output: PublicApiPostPage,
    scope: "posts.read",
  },
  ({
    boardId,
    cursor,
    includeArchived,
    limit,
    statusId,
    tagIds,
    updatedAfter,
  }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const after = yield* decodeCursorOrFail(cursor);
      // Parsed here rather than in the HTTP handler: see the board list above.
      const changedAfter = yield* parseUpdatedAfter(updatedAfter);

      // No existence check: the key proves the workspace exists, and a
      // workspace with no posts is an empty page rather than a 404.
      const page = yield* repository
        .listPosts({
          boardId: boardId ?? null,
          cursor: after,
          includeArchived: includeArchived ?? false,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          statusId: statusId ?? null,
          tagIds: tagIds ?? null,
          updatedAfter: changedAfter,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

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
      };
    })
);

export const retrievePostOperation = defineOperation(
  "retrievePost",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "Find a post by id, or by board and slug.",
    failure: POST_READ_FAILURES,
    input: RetrievePostInput,
    output: PublicApiPost,
    scope: "posts.read",
  },
  ({ boardId: rawBoardId, postId: rawPostId, slug: rawSlug }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const postId = provided(rawPostId);
      const boardId = provided(rawBoardId);
      const slug = provided(rawSlug);

      if (postId === undefined && slug === undefined) {
        return yield* invalidRequestError(
          "Provide a post id, or a boardId and a slug, to retrieve a post."
        );
      }

      // A slug only means something next to a board: matching one against
      // every board would let a caller read a post by a name it did not
      // know the board of, which is not what the parameter is for.
      if (slug !== undefined && boardId === undefined) {
        return yield* invalidRequestError(
          "boardId is required when a slug is provided."
        );
      }

      // Every identifier present must match, so an id paired with the
      // wrong board is answered as not found rather than silently returned.
      const post = yield* repository
        .findPost({
          boardId,
          organizationId: caller.organizationId,
          postId,
          slug,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(post, {
        onNone: () => Effect.fail(notFoundError("Post not found.")),
        onSome: (found) =>
          Effect.succeed(
            toPublicApiPost(found, {
              appUrl: config.appUrl,
              organizationId: caller.organizationId,
            })
          ),
      });
    })
);

export const getPostOperation = defineOperation(
  "getPost",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "Read one post by id.",
    failure: POST_READ_FAILURES,
    input: GetPostInput,
    output: PublicApiPost,
    scope: "posts.read",
  },
  ({ postId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const post = yield* repository
        .findPost({
          organizationId: caller.organizationId,
          postId,
        })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      return yield* Option.match(post, {
        // Not found rather than forbidden for another workspace's post: a
        // 403 would confirm that the id exists somewhere.
        onNone: () => Effect.fail(notFoundError("Post not found.")),
        onSome: (found) =>
          Effect.succeed(
            toPublicApiPost(found, {
              appUrl: config.appUrl,
              organizationId: caller.organizationId,
            })
          ),
      });
    })
);

export const listPostActivityOperation = defineOperation(
  "listPostActivity",
  {
    annotations: { idempotent: true, readOnly: true },
    description:
      "List one post's timeline, newest first, as a cursor-paginated page: creation, status and board moves, tag changes, merges, and comment entries, each with the values it moved between. An entry written by an API key has no actor.",
    failure: POST_READ_FAILURES,
    input: ListPostActivityInput,
    output: PublicApiPostActivityPage,
    scope: "posts.read",
  },
  ({ cursor, limit, postId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const posts = yield* currentPublicApiPostRepository;
      const activity = yield* currentPostActivityRepository;

      // The post is read first so a missing post and a post with no history
      // are not the same answer, and another workspace's post is reported as
      // missing rather than forbidden, like every other post-scoped read.
      const post = yield* posts
        .findPost({ organizationId: caller.organizationId, postId })
        .pipe(Effect.catchTag("InternalServerError", () => onInternalError));

      if (Option.isNone(post)) {
        return yield* notFoundError("Post not found.");
      }

      const after = yield* decodeCursorOrFail(cursor);
      const pageSize = limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT;

      const rows = yield* activity
        .findPage({
          after,
          limit: pageSize,
          organizationId: caller.organizationId,
          postId,
        })
        .pipe(
          withRemapDbErrors("PublicApiPostActivity", "select"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );

      const hasMore = rows.length > pageSize;
      const pageRows = hasMore ? rows.slice(0, pageSize) : rows;
      const lastRow = pageRows.at(-1);

      return {
        data: pageRows.map((row) =>
          toPublicApiPostActivity(toActivitySource(row))
        ),
        nextCursor:
          hasMore && lastRow !== undefined
            ? encodeCursor({ createdAt: lastRow.createdAt, id: lastRow.id })
            : null,
      };
    })
);

export const createPostOperation = defineOperation(
  "createPost",
  {
    description: "Create a post on a board of the calling workspace.",
    failure: POST_CREATE_FAILURES,
    input: CreatePostInput,
    output: PublicApiPost,
    scope: "posts.create",
  },
  ({
    boardId,
    content,
    createdAt,
    etaQuarter,
    statusId,
    title: rawTitle,
    author,
  }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const title = yield* parseTitle(rawTitle);

      const created = yield* repository.createPost({
        author,
        boardId,
        content,
        createdAt,
        etaQuarter: etaQuarter ?? null,
        organizationId: caller.organizationId,
        statusId,
        title,
      });

      return toPublicApiPost(created, {
        appUrl: config.appUrl,
        organizationId: caller.organizationId,
      });
    })
);

export const updatePostOperation = defineOperation(
  "updatePost",
  {
    description: "Update the fields a post request names.",
    failure: POST_WRITE_FAILURES,
    input: UpdatePostInput,
    output: PublicApiPost,
    scope: "posts.update",
  },
  ({
    author,
    boardId,
    content,
    etaQuarter,
    postId,
    statusId,
    title: rawTitle,
  }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      // A body that names no field would otherwise be answered as a
      // successful write that changed nothing but `updatedAt`, which
      // tells the caller their request did something it did not. `null`
      // is a field being named, so a body that only clears an ETA is fine,
      // and an author is a field like any other.
      const namesAField =
        rawTitle !== undefined ||
        content !== undefined ||
        statusId !== undefined ||
        boardId !== undefined ||
        etaQuarter !== undefined ||
        author !== undefined;

      if (!namesAField) {
        return yield* invalidRequestError(
          "Provide at least one field to update."
        );
      }

      const title =
        rawTitle === undefined ? undefined : yield* parseTitle(rawTitle);

      const updated = yield* repository.updatePost({
        author,
        boardId,
        content,
        etaQuarter,
        organizationId: caller.organizationId,
        postId,
        statusId,
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
            })
          ),
      });
    })
);

export const setPostTagsOperation = defineOperation(
  "setPostTags",
  {
    description: "Replace the complete set of tags a post carries.",
    failure: POST_WRITE_FAILURES,
    input: SetPostTagsInput,
    output: PublicApiPostTags,
    scope: "tags.assign",
  },
  ({ postId, tagIds }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const db = yield* currentPublicApiDatabase;
      const tags = yield* currentTagRepository;
      const activities = yield* currentPostActivityRepository;

      const wanted = [...new Set(tagIds)];

      return yield* db
        .transaction(() =>
          Effect.gen(function* () {
            if (wanted.length > 0) {
              // `key share` is the lock the foreign-key check itself takes: a
              // tag deleted concurrently either loses the race and is missing
              // from this read, or waits here until these rows exist and then
              // cascades them away with it.
              const known = yield* tags.countExistingTags({
                lock: "key share",
                organizationId: caller.organizationId,
                tagIds: wanted,
              });

              if (known !== wanted.length) {
                return yield* invalidRequestError(
                  "One or more tagIds do not exist in this workspace."
                );
              }
            }

            // The replacement locks the post row and returns what it carried
            // before, so the write and the timeline entry are decided from the
            // same snapshot. A post outside this workspace is reported on the
            // dashboard's policy vocabulary; the published answer is the
            // missing resource.
            const replaced = yield* tags
              .setPostTags({
                organizationId: caller.organizationId,
                postId,
                tagIds: wanted,
              })
              .pipe(
                Effect.catchTag("PolicyDenied", () =>
                  Effect.fail(notFoundError("Post not found."))
                )
              );

            yield* activities.createMany(
              postTagChangeActivities({
                previousTagIds: replaced.previousTagIds,
                nextTagIds: wanted,
                actor: {
                  actorId: null,
                  actorMemberId: null,
                  organizationId: caller.organizationId,
                  postId,
                },
              })
            );

            return { data: replaced.tags.map(toPublicApiTag) };
          })
        )
        // One remap for the whole transaction: the repository's id generation,
        // the tag read, and the timeline write all surface driver failures the
        // same way, and a failure anywhere rolls the transaction back.
        .pipe(
          withRemapDbErrors("PublicApiTag", "update"),
          Effect.catchTag("InternalServerError", () => onInternalError)
        );
    })
);

export const deletePostOperation = defineOperation(
  "deletePost",
  {
    annotations: { destructive: true },
    description: "Delete a post; a merged post is refused.",
    failure: POST_WRITE_FAILURES,
    input: DeletePostInput,
    output: Schema.Void,
    scope: "posts.delete",
  },
  ({ postId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;

      yield* repository.deletePost({
        organizationId: caller.organizationId,
        postId,
      });
    })
);

export const postOperations = [
  listBoardPostsOperation,
  listPostsOperation,
  retrievePostOperation,
  getPostOperation,
  listPostActivityOperation,
  createPostOperation,
  updatePostOperation,
  setPostTagsOperation,
  deletePostOperation,
] as const;

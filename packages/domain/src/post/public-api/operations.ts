import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_DEFAULT_LIMIT } from "../../public-api/common";
import { currentPublicApiConfig } from "../../public-api/config";
import { decodeCursorOrFail, encodeCursor } from "../../public-api/cursor";
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
import { parseTitle } from "../../public-api/parse";
import { toPublicApiPost, toPublicApiPostSummary } from "./mappers";
import { currentPublicApiPostRepository } from "./repository";
import {
  CreatePostInput,
  DeletePostInput,
  GetPostInput,
  ListBoardPostsInput,
  ListPostsInput,
  PublicApiPost,
  PublicApiPostPage,
  RetrievePostInput,
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
 * The writes are the dashboard's shared write path with an `api_key` actor
 * (`post/write.ts`), so an API-created post lands in the same timeline, the
 * same integration events, and the same notification fan-out as one submitted
 * through the dashboard.
 */

export const listBoardPostsOperation = defineOperation(
  "listBoardPosts",
  {
    annotations: { idempotent: true, readOnly: true },
    description: "List one board's posts, newest first.",
    failure: POST_READ_FAILURES,
    input: ListBoardPostsInput,
    output: PublicApiPostPage,
    scope: "posts.read",
  },
  ({ boardId, cursor, includeArchived, limit, statusId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const after = yield* decodeCursorOrFail(cursor);

      const page = yield* repository
        .listBoardPosts({
          boardId,
          cursor: after,
          includeArchived: includeArchived ?? false,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          statusId: statusId ?? null,
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
    description: "List the workspace's posts, newest first.",
    failure: POST_READ_FAILURES,
    input: ListPostsInput,
    output: PublicApiPostPage,
    scope: "posts.read",
  },
  ({ cursor, includeArchived, limit, statusId }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const after = yield* decodeCursorOrFail(cursor);

      // No existence check: the key proves the workspace exists, and a
      // workspace with no posts is an empty page rather than a 404.
      const page = yield* repository
        .listPosts({
          cursor: after,
          includeArchived: includeArchived ?? false,
          limit: limit ?? PUBLIC_API_PAGE_DEFAULT_LIMIT,
          organizationId: caller.organizationId,
          statusId: statusId ?? null,
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

export const createPostOperation = defineOperation(
  "createPost",
  {
    description: "Create a post on a board of the calling workspace.",
    failure: POST_CREATE_FAILURES,
    input: CreatePostInput,
    output: PublicApiPost,
    scope: "posts.create",
  },
  ({ boardId, content, etaQuarter, statusId, title: rawTitle }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      const title = yield* parseTitle(rawTitle);

      const created = yield* repository.createPost({
        boardId,
        content,
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
  ({ boardId, content, etaQuarter, postId, statusId, title: rawTitle }) =>
    Effect.gen(function* () {
      const caller = yield* currentPublicApiCaller;
      const repository = yield* currentPublicApiPostRepository;
      const config = yield* currentPublicApiConfig;

      // A body that names no field would otherwise be answered as a
      // successful write that changed nothing but `updatedAt`, which
      // tells the caller their request did something it did not. `null`
      // is a field being named, so a body that only clears an ETA is fine.
      const namesAField =
        rawTitle !== undefined ||
        content !== undefined ||
        statusId !== undefined ||
        boardId !== undefined ||
        etaQuarter !== undefined;

      if (!namesAField) {
        return yield* invalidRequestError(
          "Provide at least one field to update."
        );
      }

      const title =
        rawTitle === undefined ? undefined : yield* parseTitle(rawTitle);

      const updated = yield* repository.updatePost({
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
  createPostOperation,
  updatePostOperation,
  deletePostOperation,
] as const;

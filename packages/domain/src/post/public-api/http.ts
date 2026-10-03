import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as OpenApi from "effect/http-api/OpenApi";

import type { PublicApiPostGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_CREATE_ERROR_SCHEMAS,
  PUBLIC_API_ERROR_SCHEMAS,
} from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import {
  parseIncludeArchived,
  parseLimit,
  parseTagIds,
  providedQueryParam,
} from "../../public-api/parse";
import {
  createPostOperation,
  deletePostOperation,
  getPostOperation,
  listBoardPostsOperation,
  listPostActivityOperation,
  listPostsOperation,
  retrievePostOperation,
  setPostTagsOperation,
  updatePostOperation,
} from "./operations";
import {
  CreatePostPayload,
  DeletePostParams,
  GetPostParams,
  ListBoardPostsParams,
  ListBoardPostsQuery,
  ListPostActivityParams,
  ListPostActivityQuery,
  ListPostsQuery,
  PublicApiPost,
  PublicApiPostActivityPage,
  PublicApiPostPage,
  PublicApiPostTags,
  RetrievePostQuery,
  SetPostTagsParams,
  SetPostTagsPayload,
  UpdatePostParams,
  UpdatePostPayload,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiPostGroup>;

/** The post endpoints, and their HTTP implementations. */
export const postEndpoints = [
  HttpApiEndpoint.get("listBoardPosts", "/boards/:boardId/posts", {
    params: ListBoardPostsParams,
    query: ListBoardPostsQuery,
    success: PublicApiPostPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Posts")
    .annotate(OpenApi.Summary, "List a board's posts")
    .annotate(
      OpenApi.Description,
      "Returns the posts on one board of the calling workspace, newest first, as a cursor-paginated page. Private boards are included: the key belongs to the workspace, so board visibility does not restrict it. Archived posts appear only with includeArchived=true, and posts merged into another post are never listed. `tagIds` is a comma-separated list and keeps posts carrying at least one of the tags; `updatedAfter` keeps posts changed after the given instant, which is how a sync catches up without re-reading everything."
    ),
  HttpApiEndpoint.get("listPosts", "/posts", {
    query: ListPostsQuery,
    success: PublicApiPostPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Posts")
    .annotate(OpenApi.Summary, "List the workspace's posts")
    .annotate(
      OpenApi.Description,
      "Returns the posts of the calling workspace across every board, newest first, as a cursor-paginated page. Private boards are included: the key belongs to the workspace, so board visibility does not restrict it. Archived posts appear only with includeArchived=true, and posts merged into another post are never listed. `boardId`, `tagIds`, and `updatedAfter` narrow the page, so one endpoint serves both a filtered read and a sync that only wants what changed. Use `GET /boards/{boardId}/posts` to page one board."
    ),
  HttpApiEndpoint.get("retrievePost", "/posts/retrieve", {
    query: RetrievePostQuery,
    success: PublicApiPost,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Retrieve Post")
    .annotate(OpenApi.Summary, "Find a post by id, or by board and slug")
    .annotate(
      OpenApi.Description,
      "Returns one post with its sanitized body, named either by `id` or by the `boardId` and `slug` pair from its public URL. `boardId` is required when a `slug` is given; a request that names neither an id nor a slug is rejected. Every identifier present must match, so an id combined with another board, or a slug combined with the wrong board, is reported as not found rather than silently resolved. Posts of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.get("getPost", "/posts/:postId", {
    params: GetPostParams,
    success: PublicApiPost,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Get Post")
    .annotate(OpenApi.Summary, "Get a post")
    .annotate(
      OpenApi.Description,
      "Returns one post with its sanitized body. Posts of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.get("listPostActivity", "/posts/:postId/activity", {
    params: ListPostActivityParams,
    query: ListPostActivityQuery,
    success: PublicApiPostActivityPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Post Activity")
    .annotate(OpenApi.Summary, "List a post's timeline")
    .annotate(
      OpenApi.Description,
      'Returns one post\'s history, newest first, as a cursor-paginated page: creation, status and board moves, tag changes, merges, and comment entries. `kind` names what happened and `previousValue`/`nextValue` are the values it moved between — a status id for STATUS_CHANGED, a tag id for TAG_ADDED, a post id for POST_MERGED. `actor` is null when the entry was written by an API key, which has no member identity; the dashboard shows the same entry as "Someone". A post merged into another is readable and reports its own history, including the merge.'
    ),
  HttpApiEndpoint.post("createPost", "/posts", {
    payload: CreatePostPayload,
    success: PublicApiPost.pipe(HttpApiSchema.status(201)),
    error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Create Post")
    .annotate(OpenApi.Summary, "Create a post")
    .annotate(
      OpenApi.Description,
      "Creates a post on a board of the calling workspace and returns it. The id is assigned by the server, the title is trimmed, the slug is derived from it and deduplicated, and the body is sanitized before it is stored. A `boardId` or `statusId` that does not exist in the workspace is an invalid request. The post is recorded with `API` as its source and reaches the workspace's integrations and notifications like any other submission. `author` optionally attributes the post to a customer — an API key has no user of its own — resolved by userId, contactId, externalId, or email, in that order; absent, the post has no author. `createdAt` optionally backdates the post for an import: the list orders by it, while `updatedAt` stays the time of the write so a sync reading `updatedAfter` still sees the row."
    ),
  HttpApiEndpoint.patch("updatePost", "/posts/:postId", {
    params: UpdatePostParams,
    payload: UpdatePostPayload,
    success: PublicApiPost,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Update Post")
    .annotate(OpenApi.Summary, "Update a post")
    .annotate(
      OpenApi.Description,
      "Updates the fields the request names and returns the post afterwards. An omitted field is left as it is and an explicit null clears a nullable one, so `etaQuarter: null` removes the estimate. A body that names no field is rejected as an invalid request. Moving the post to another board or status records the change in its timeline and, for a status change, notifies its subscribers exactly as the dashboard does. `author` re-attributes the post to the customer the request names, resolved the same way a create resolves it, and retires the previous author's subscription. A post merged into another post is refused."
    ),
  HttpApiEndpoint.put("setPostTags", "/posts/:postId/tags", {
    params: SetPostTagsParams,
    payload: SetPostTagsPayload,
    success: PublicApiPostTags,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Set Post Tags")
    .annotate(OpenApi.Summary, "Set which tags a post carries")
    .annotate(
      OpenApi.Description,
      "Replaces the post's tags with the ids given and returns the tags it carries afterwards. An empty list clears them. Ids that do not exist in the workspace are rejected as an invalid request rather than ignored, and the post's timeline records the tags that were added and removed."
    ),
  HttpApiEndpoint.delete("deletePost", "/posts/:postId", {
    params: DeletePostParams,
    success: HttpApiSchema.NoContent,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Delete Post")
    .annotate(OpenApi.Summary, "Delete a post")
    .annotate(
      OpenApi.Description,
      "Deletes a post and cannot be undone. A key holding this scope deletes without the dashboard's creator and engagement restriction: it is the workspace's own credential, not a member acting on their own posts. Deleting a post that absorbed merged duplicates restores those duplicates to the board rather than orphaning them. A merged post is refused, and a post that is already gone is reported as not found."
    ),
] as const;

export const postHandlers = {
  listBoardPosts: (({ params, query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      const includeArchived = yield* parseIncludeArchived(
        query.includeArchived
      );
      const tagIds = yield* parseTagIds(query.tagIds);
      return yield* listBoardPostsOperation.handler({
        boardId: params.boardId,
        cursor: query.cursor,
        includeArchived,
        limit,
        statusId: query.status ?? null,
        tagIds: tagIds ?? undefined,
        // Passed through raw: the operation validates the ISO shape and the
        // calendar, so the HTTP and MCP surfaces share one check.
        updatedAfter: query.updatedAfter,
      });
    })) satisfies HandlerOf<PublicApiGroup, "listBoardPosts">,

  listPosts: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      const includeArchived = yield* parseIncludeArchived(
        query.includeArchived
      );
      const tagIds = yield* parseTagIds(query.tagIds);
      return yield* listPostsOperation.handler({
        boardId: providedQueryParam(query.boardId),
        cursor: query.cursor,
        includeArchived,
        limit,
        statusId: query.status ?? null,
        tagIds: tagIds ?? undefined,
        // Passed through raw: see the board list above.
        updatedAfter: query.updatedAfter,
      });
    })) satisfies HandlerOf<PublicApiGroup, "listPosts">,

  retrievePost: (({ query }) =>
    retrievePostOperation.handler({
      boardId: providedQueryParam(query.boardId),
      postId: providedQueryParam(query.id),
      slug: providedQueryParam(query.slug),
    })) satisfies HandlerOf<PublicApiGroup, "retrievePost">,

  getPost: (({ params }) =>
    getPostOperation.handler({
      postId: params.postId,
    })) satisfies HandlerOf<PublicApiGroup, "getPost">,

  listPostActivity: (({ params, query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listPostActivityOperation.handler({
        cursor: query.cursor,
        limit,
        postId: params.postId,
      });
    })) satisfies HandlerOf<PublicApiGroup, "listPostActivity">,

  createPost: (({ payload }) =>
    createPostOperation.handler({
      author: payload.author,
      boardId: payload.boardId,
      content: payload.content,
      createdAt: payload.createdAt,
      etaQuarter: payload.etaQuarter,
      statusId: payload.statusId,
      title: payload.title,
    })) satisfies HandlerOf<PublicApiGroup, "createPost">,

  updatePost: (({ params, payload }) =>
    updatePostOperation.handler({
      author: payload.author,
      boardId: payload.boardId,
      content: payload.content,
      etaQuarter: payload.etaQuarter,
      postId: params.postId,
      statusId: payload.statusId,
      title: payload.title,
    })) satisfies HandlerOf<PublicApiGroup, "updatePost">,

  setPostTags: (({ params, payload }) =>
    setPostTagsOperation.handler({
      postId: params.postId,
      tagIds: payload.tagIds,
    })) satisfies HandlerOf<PublicApiGroup, "setPostTags">,

  deletePost: (({ params }) =>
    deletePostOperation.handler({
      postId: params.postId,
    })) satisfies HandlerOf<PublicApiGroup, "deletePost">,
};

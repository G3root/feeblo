import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiSchema from "effect/http-api/HttpApiSchema";
import * as OpenApi from "effect/http-api/OpenApi";

import type { PublicApiCommentGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_ERROR_SCHEMAS,
  PUBLIC_API_WRITE_ERROR_SCHEMAS,
} from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import type { PublicApiCaller } from "../../public-api/middleware";
import type { PublicApiDependencies } from "../../public-api/operations";
import { parseLimit } from "../../public-api/parse";
import {
  createCommentOperation,
  deleteCommentOperation,
  getCommentOperation,
  listPostCommentsOperation,
  pinCommentOperation,
  unpinCommentOperation,
  updateCommentOperation,
} from "./operations";
import {
  CreateCommentParams,
  CreateCommentPayload,
  DeleteCommentParams,
  GetCommentParams,
  ListPostCommentsParams,
  ListPostCommentsQuery,
  PinCommentParams,
  PublicApiComment,
  PublicApiCommentPage,
  UnpinCommentParams,
  UpdateCommentParams,
  UpdateCommentPayload,
} from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiCommentGroup>;

/**
 * The comment endpoints, and their HTTP implementations.
 *
 * The declarations are the published contract; the handlers do only the
 * HTTP-specific work — parsing the string query parameters — and delegate to
 * `./operations.ts`.
 */
export const commentEndpoints = [
  HttpApiEndpoint.get("listPostComments", "/posts/:postId/comments", {
    params: ListPostCommentsParams,
    query: ListPostCommentsQuery,
    success: PublicApiCommentPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Comments")
    .annotate(OpenApi.Summary, "List a post's comments")
    .annotate(
      OpenApi.Description,
      "Returns the comments on one post of the calling workspace, newest first, as a cursor-paginated page. Internal comments are included, because the key belongs to the workspace; a pinned comment carries a pinnedAt and appears in its created position rather than first. Comments that a merge moved onto this post are listed here; a post that was merged into another reports no comments of its own, because its comments now live on the survivor."
    ),
  HttpApiEndpoint.post("createComment", "/posts/:postId/comments", {
    params: CreateCommentParams,
    payload: CreateCommentPayload,
    success: PublicApiComment.pipe(HttpApiSchema.status(201)),
    error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Create Comment")
    .annotate(OpenApi.Summary, "Comment on a post")
    .annotate(
      OpenApi.Description,
      "Creates a comment on a post and returns it. The comment is attributed to the customer the author names — an API key has no user of its own — resolved by userId, contactId, externalId, or email, in that order. A post whose conversation is locked or that was merged into another post, or a parentCommentId that names a comment on another post or workspace, is refused."
    ),
  HttpApiEndpoint.get("getComment", "/comments/:commentId", {
    params: GetCommentParams,
    success: PublicApiComment,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Get Comment")
    .annotate(OpenApi.Summary, "Get a comment")
    .annotate(
      OpenApi.Description,
      "Returns one comment. Comments of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.patch("updateComment", "/comments/:commentId", {
    params: UpdateCommentParams,
    payload: UpdateCommentPayload,
    success: PublicApiComment,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Update Comment")
    .annotate(OpenApi.Summary, "Replace a comment's body and visibility")
    .annotate(
      OpenApi.Description,
      "Replaces the comment's body, and its visibility when the request names one, and returns the comment afterwards. Omitting visibility leaves it as it is. The body is sanitized exactly as the dashboard sanitizes it, and the post's timeline records the edit."
    ),
  HttpApiEndpoint.delete("deleteComment", "/comments/:commentId", {
    params: DeleteCommentParams,
    success: HttpApiSchema.NoContent,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Delete Comment")
    .annotate(OpenApi.Summary, "Delete a comment")
    .annotate(
      OpenApi.Description,
      "Deletes a comment and every reply beneath it. The comment is gone immediately and cannot be restored."
    ),
  HttpApiEndpoint.post("pinComment", "/comments/:commentId/pin", {
    params: PinCommentParams,
    success: PublicApiComment,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Pin Comment")
    .annotate(OpenApi.Summary, "Pin a comment to the top of its post")
    .annotate(
      OpenApi.Description,
      "Pins a comment and returns it with its pinnedAt. A post has at most one pinned comment: pinning one unpins whatever was pinned before it. The post's timeline records the change."
    ),
  HttpApiEndpoint.post("unpinComment", "/comments/:commentId/unpin", {
    params: UnpinCommentParams,
    success: PublicApiComment,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Unpin Comment")
    .annotate(OpenApi.Summary, "Unpin a comment")
    .annotate(
      OpenApi.Description,
      "Unpins a comment and returns it with a null pinnedAt. Unpinning a comment that is not pinned changes nothing and is answered the same way, so a retried request does not have to distinguish 'already unpinned' from 'gone'."
    ),
] as const;

export const commentHandlers = (
  context: Context.Context<PublicApiDependencies>
) => ({
  listPostComments: (({ params, query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listPostCommentsOperation.handler({
        ...params,
        cursor: query.cursor,
        limit,
      });
    }).pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listPostComments",
    PublicApiCaller
  >,

  // The body is the operation's own input minus the path, so handing it over
  // cannot drop a field the operation gains.
  createComment: (({ params, payload }) =>
    createCommentOperation
      .handler({
        ...payload,
        ...params,
      })
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "createComment",
    PublicApiCaller
  >,

  getComment: (({ params }) =>
    getCommentOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "getComment",
    PublicApiCaller
  >,

  updateComment: (({ params, payload }) =>
    updateCommentOperation
      .handler({
        ...payload,
        ...params,
      })
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "updateComment",
    PublicApiCaller
  >,

  deleteComment: (({ params }) =>
    deleteCommentOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "deleteComment",
    PublicApiCaller
  >,

  pinComment: (({ params }) =>
    pinCommentOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "pinComment",
    PublicApiCaller
  >,

  unpinComment: (({ params }) =>
    unpinCommentOperation
      .handler(params)
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "unpinComment",
    PublicApiCaller
  >,
});

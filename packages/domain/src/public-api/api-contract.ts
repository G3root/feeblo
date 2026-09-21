import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import { PUBLIC_API_ERROR_SCHEMAS } from "./errors";
import { ApiKeyAuthMiddleware } from "./middleware";
import {
  GetPostParams,
  ListBoardPostsParams,
  ListBoardPostsQuery,
  PublicApiPost,
  PublicApiPostPage,
} from "./schema";

/**
 * The Public API's own `HttpApi` instance.
 *
 * Separate from the dashboard's `Api` so the published contract is curated
 * rather than a projection of internal endpoints: the spec served at
 * `/api/v1/openapi.json` describes exactly these two endpoints, and the
 * dashboard's spec stays dev-only.
 */
export class PublicApiV1Group extends HttpApiGroup.make("PublicApiV1")
  .add(
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
        "Returns the posts on one board of the calling workspace, newest first, as a cursor-paginated page. Private boards are included: the key belongs to the workspace, so board visibility does not restrict it. Archived posts appear only with includeArchived=true, and posts merged into another post are never listed."
      )
  )
  .add(
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
      )
  )
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApi extends HttpApi.make("PublicApi")
  .add(PublicApiV1Group)
  .prefix("/api/v1") {}

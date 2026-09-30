import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import type { PublicApiTagGroup } from "../../public-api/api-contract";
import {
  PUBLIC_API_CREATE_ERROR_SCHEMAS,
  PUBLIC_API_ERROR_SCHEMAS,
  PUBLIC_API_WRITE_ERROR_SCHEMAS,
} from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiTagGroup>;
import { parseLimit } from "../../public-api/parse";
import {
  createTagOperation,
  deleteTagOperation,
  getTagOperation,
  listTagsOperation,
  setPostTagsOperation,
  updateTagOperation,
} from "./operations";
import {
  CreateTagPayload,
  DeleteTagParams,
  GetTagParams,
  ListTagsQuery,
  PublicApiPostTags,
  PublicApiTagDetail,
  PublicApiTagPage,
  SetPostTagsParams,
  SetPostTagsPayload,
  UpdateTagParams,
  UpdateTagPayload,
} from "./schema";

/**
 * The tag endpoints, and their HTTP implementations.
 *
 * The declarations are the published contract — paths, parameters, statuses,
 * and OpenAPI prose — and the handlers do only the HTTP-specific work: parsing
 * string query parameters, then delegating to the operation. Business behavior
 * lives in `./operations.ts`, so an MCP tool or a CLI calls the same code
 * without an HTTP request in between.
 */

export const tagEndpoints = [
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
  HttpApiEndpoint.get("listTags", "/tags", {
    query: ListTagsQuery,
    success: PublicApiTagPage,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Tags")
    .annotate(OpenApi.Summary, "List the workspace's tags")
    .annotate(
      OpenApi.Description,
      "Returns the tags of the calling workspace, newest first, as a cursor-paginated page. Every tag is returned whether or not a post carries it."
    ),
  HttpApiEndpoint.post("createTag", "/tags", {
    payload: CreateTagPayload,
    success: PublicApiTagDetail.pipe(HttpApiSchema.status(201)),
    error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Create Tag")
    .annotate(OpenApi.Summary, "Create a tag")
    .annotate(
      OpenApi.Description,
      "Creates a tag in the calling workspace and returns it. The name is trimmed; the slug is derived from it. A name, or a name that produces the same slug, already used in the workspace is reported as a conflict rather than creating a near-duplicate."
    ),
  HttpApiEndpoint.get("getTag", "/tags/:tagId", {
    params: GetTagParams,
    success: PublicApiTagDetail,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Get Tag")
    .annotate(OpenApi.Summary, "Get a tag")
    .annotate(
      OpenApi.Description,
      "Returns one tag. Tags of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
    ),
  HttpApiEndpoint.patch("updateTag", "/tags/:tagId", {
    params: UpdateTagParams,
    payload: UpdateTagPayload,
    success: PublicApiTagDetail,
    error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Update Tag")
    .annotate(OpenApi.Summary, "Rename a tag")
    .annotate(
      OpenApi.Description,
      "Renames a tag and returns it. The name is the only writable field; the slug is re-derived from it, and a name already used in the workspace is reported as a conflict. Renaming does not change which posts carry the tag."
    ),
  HttpApiEndpoint.delete("deleteTag", "/tags/:tagId", {
    params: DeleteTagParams,
    success: HttpApiSchema.NoContent,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "Delete Tag")
    .annotate(OpenApi.Summary, "Delete a tag")
    .annotate(
      OpenApi.Description,
      "Deletes a tag and removes it from every post that carried it. The tag is gone immediately and cannot be restored; the posts themselves are untouched."
    ),
] as const;

export const tagHandlers = {
  setPostTags: (({ params, payload }) =>
    setPostTagsOperation.handler({
      postId: params.postId,
      tagIds: payload.tagIds,
    })) satisfies HandlerOf<PublicApiGroup, "setPostTags">,

  listTags: (({ query }) =>
    Effect.gen(function* () {
      const limit = yield* parseLimit(query.limit);
      return yield* listTagsOperation.handler({
        cursor: query.cursor,
        limit,
      });
    })) satisfies HandlerOf<PublicApiGroup, "listTags">,

  createTag: (({ payload }) =>
    createTagOperation.handler({ name: payload.name })) satisfies HandlerOf<
    PublicApiGroup,
    "createTag"
  >,

  getTag: (({ params }) =>
    getTagOperation.handler({ tagId: params.tagId })) satisfies HandlerOf<
    PublicApiGroup,
    "getTag"
  >,

  updateTag: (({ params, payload }) =>
    updateTagOperation.handler({
      name: payload.name,
      tagId: params.tagId,
    })) satisfies HandlerOf<PublicApiGroup, "updateTag">,

  deleteTag: (({ params }) =>
    deleteTagOperation.handler({ tagId: params.tagId })) satisfies HandlerOf<
    PublicApiGroup,
    "deleteTag"
  >,
};

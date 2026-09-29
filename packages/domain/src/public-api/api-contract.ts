import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";
import * as OpenApi from "effect/unstable/httpapi/OpenApi";

import {
  PUBLIC_API_CREATE_ERROR_SCHEMAS,
  PUBLIC_API_ERROR_SCHEMAS,
  PUBLIC_API_WRITE_ERROR_SCHEMAS,
} from "./errors";
import {
  ApiKeyAuthMiddleware,
  PublicApiSchemaErrorHandler,
} from "./middleware";
import {
  CreateChangelogPayload,
  CreateCompanyPayload,
  CreatePostPayload,
  CreateTagPayload,
  DeleteChangelogParams,
  DeleteCompanyParams,
  DeletePostParams,
  DeleteTagParams,
  GetChangelogParams,
  GetCompanyParams,
  GetPostParams,
  GetTagParams,
  ListBoardPostsParams,
  ListBoardPostsQuery,
  ListChangelogQuery,
  ListCompaniesQuery,
  ListPostsQuery,
  ListTagsQuery,
  PublicApiChangelog,
  PublicApiChangelogPage,
  PublicApiCompany,
  PublicApiCompanyPage,
  PublicApiPost,
  PublicApiPostPage,
  PublicApiPostTags,
  PublicApiTagDetail,
  PublicApiTagPage,
  RetrievePostQuery,
  SetPostTagsParams,
  SetPostTagsPayload,
  UpdateChangelogParams,
  UpdateChangelogPayload,
  UpdateCompanyParams,
  UpdateCompanyPayload,
  UpdatePostParams,
  UpdatePostPayload,
  UpdateTagParams,
  UpdateTagPayload,
} from "./schema";

/**
 * The Public API's own `HttpApi` instance.
 *
 * Separate from the dashboard's `Api` so the published contract is curated
 * rather than a projection of internal endpoints: the spec served at
 * `/api/v1/openapi.json` describes exactly these endpoints, and the
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
    HttpApiEndpoint.get("listPosts", "/posts", {
      query: ListPostsQuery,
      success: PublicApiPostPage,
      error: PUBLIC_API_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "List Posts")
      .annotate(OpenApi.Summary, "List the workspace's posts")
      .annotate(
        OpenApi.Description,
        "Returns the posts of the calling workspace across every board, newest first, as a cursor-paginated page. Private boards are included: the key belongs to the workspace, so board visibility does not restrict it. Archived posts appear only with includeArchived=true, and posts merged into another post are never listed. Use `GET /boards/{boardId}/posts` to page one board."
      )
  )
  .add(
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
  .add(
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
      )
  )
  .add(
    HttpApiEndpoint.post("createPost", "/posts", {
      payload: CreatePostPayload,
      success: PublicApiPost.pipe(HttpApiSchema.status(201)),
      error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Create Post")
      .annotate(OpenApi.Summary, "Create a post")
      .annotate(
        OpenApi.Description,
        "Creates a post on a board of the calling workspace and returns it. The id is assigned by the server, the title is trimmed, the slug is derived from it and deduplicated, and the body is sanitized before it is stored. A `boardId` or `statusId` that does not exist in the workspace is an invalid request. The post is recorded with `API` as its source and reaches the workspace's integrations and notifications like any other submission, but it has no author: a machine key is not a member."
      )
  )
  .add(
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
        "Updates the fields the request names and returns the post afterwards. An omitted field is left as it is and an explicit null clears a nullable one, so `etaQuarter: null` removes the estimate. A body that names no field is rejected as an invalid request. Moving the post to another board or status records the change in its timeline and, for a status change, notifies its subscribers exactly as the dashboard does. A post merged into another post is refused."
      )
  )
  .add(
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
      )
  )
  .add(
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
      )
  )
  .add(
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
      )
  )
  .add(
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
      )
  )
  .add(
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
      )
  )
  .add(
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
      )
  )
  .add(
    HttpApiEndpoint.get("listCompanies", "/companies", {
      query: ListCompaniesQuery,
      success: PublicApiCompanyPage,
      error: PUBLIC_API_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "List Companies")
      .annotate(OpenApi.Summary, "List the workspace's companies")
      .annotate(
        OpenApi.Description,
        "Returns the companies of the calling workspace, newest first, as a cursor-paginated page. A company is an account record; the contacts who belong to it are not returned, and neither are the workspace's custom attribute values."
      )
  )
  .add(
    HttpApiEndpoint.post("createCompany", "/companies", {
      payload: CreateCompanyPayload,
      success: PublicApiCompany.pipe(HttpApiSchema.status(201)),
      error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Create Company")
      .annotate(OpenApi.Summary, "Create a company")
      .annotate(
        OpenApi.Description,
        "Creates a company in the calling workspace and returns it. The name is trimmed, the id is minted by the server, and the company is recorded with the API as its source. A name, or an externalId, already used in the workspace is reported as a conflict rather than creating a second record for the same account."
      )
  )
  .add(
    HttpApiEndpoint.get("getCompany", "/companies/:companyId", {
      params: GetCompanyParams,
      success: PublicApiCompany,
      error: PUBLIC_API_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Get Company")
      .annotate(OpenApi.Summary, "Get a company")
      .annotate(
        OpenApi.Description,
        "Returns one company. Companies of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
      )
  )
  .add(
    HttpApiEndpoint.patch("updateCompany", "/companies/:companyId", {
      params: UpdateCompanyParams,
      payload: UpdateCompanyPayload,
      success: PublicApiCompany,
      error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Update Company")
      .annotate(OpenApi.Summary, "Update a company")
      .annotate(
        OpenApi.Description,
        "Updates the fields the request names and returns the company afterwards. An omitted field is left as it is and an explicit null clears a nullable one. A body that names no field is rejected as an invalid request, and a name or externalId another company in the workspace already holds is reported as a conflict."
      )
  )
  .add(
    HttpApiEndpoint.delete("deleteCompany", "/companies/:companyId", {
      params: DeleteCompanyParams,
      success: HttpApiSchema.NoContent,
      error: PUBLIC_API_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Delete Company")
      .annotate(OpenApi.Summary, "Delete a company")
      .annotate(
        OpenApi.Description,
        "Deletes a company and detaches it from the contacts that belonged to it. The contacts themselves are untouched and keep their own records; the company cannot be restored."
      )
  )
  .middleware(PublicApiSchemaErrorHandler)
  .add(
    HttpApiEndpoint.get("listChangelog", "/changelog", {
      query: ListChangelogQuery,
      success: PublicApiChangelogPage,
      error: PUBLIC_API_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "List Changelog Entries")
      .annotate(OpenApi.Summary, "List the workspace's changelog entries")
      .annotate(
        OpenApi.Description,
        "Returns the changelog entries of the calling workspace, newest first, as a cursor-paginated page. Drafts and scheduled entries are included; pass status=published to list only what readers can already see."
      )
  )
  .add(
    HttpApiEndpoint.get("getChangelog", "/changelog/:changelogId", {
      params: GetChangelogParams,
      success: PublicApiChangelog,
      error: PUBLIC_API_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Get Changelog Entry")
      .annotate(OpenApi.Summary, "Get a changelog entry")
      .annotate(
        OpenApi.Description,
        "Returns one changelog entry with its sanitized body. Entries of other workspaces are reported as not found rather than forbidden, so an id cannot be used to probe another workspace."
      )
  )
  .add(
    HttpApiEndpoint.post("createChangelog", "/changelog", {
      payload: CreateChangelogPayload,
      success: PublicApiChangelog.pipe(HttpApiSchema.status(201)),
      error: PUBLIC_API_CREATE_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Create Changelog Entry")
      .annotate(OpenApi.Summary, "Create a changelog entry")
      .annotate(
        OpenApi.Description,
        "Creates a changelog entry in the calling workspace and returns it. The entry is a draft unless the request says otherwise. Publishing it — status=published — additionally requires the changelog.publish scope, because it emails everyone subscribed to the workspace changelog."
      )
  )
  .add(
    HttpApiEndpoint.patch("updateChangelog", "/changelog/:changelogId", {
      params: UpdateChangelogParams,
      payload: UpdateChangelogPayload,
      success: PublicApiChangelog,
      error: PUBLIC_API_WRITE_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Update Changelog Entry")
      .annotate(OpenApi.Summary, "Replace a changelog entry's writable fields")
      .annotate(
        OpenApi.Description,
        "Replaces the entry's title, slug, body, cover image, status, and timestamps, and returns the entry afterwards. The fields sent are the entry's new state. Moving an entry into published requires the changelog.publish scope, because it emails subscribers; editing an already-published entry does not."
      )
  )
  .add(
    HttpApiEndpoint.delete("deleteChangelog", "/changelog/:changelogId", {
      params: DeleteChangelogParams,
      success: HttpApiSchema.NoContent,
      error: PUBLIC_API_ERROR_SCHEMAS,
    })
      .annotate(OpenApi.Title, "Delete Changelog Entry")
      .annotate(OpenApi.Summary, "Delete a changelog entry")
      .annotate(
        OpenApi.Description,
        "Deletes a changelog entry and its links to the posts it announced. The entry is gone immediately and cannot be restored; the posts themselves are untouched."
      )
  )
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApi extends HttpApi.make("PublicApi")
  .add(PublicApiV1Group)
  .prefix("/api/v1") {}

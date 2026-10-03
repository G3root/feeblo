import * as HttpApi from "effect/http-api/HttpApi";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as OpenApi from "effect/http-api/OpenApi";

import { boardEndpoints } from "../board/public-api/http";
import { changelogEndpoints } from "../changelog/public-api/http";
import { commentEndpoints } from "../comments/public-api/http";
import { companyEndpoints } from "../company/public-api/http";
import { statusEndpoints } from "../post-status/public-api/http";
import { postEndpoints } from "../post/public-api/http";
import { tagEndpoints } from "../tag/public-api/http";
import {
  ApiKeyAuthMiddleware,
  PublicApiSchemaErrorHandler,
} from "./middleware";

/**
 * One group per resource, because the group *is* the document's category.
 *
 * Effect derives each operation's OpenAPI `tags` from its group — the group's
 * `OpenApi.Title` annotation if it carries one, its identifier otherwise — and
 * never from an endpoint's own annotations. Two resources in one group are two
 * resources in one sidebar section, so the identifiers below are both the
 * section names customers read and the prefix of every `operationId`
 * (`Posts.listPosts`).
 *
 * Each group is a composition of one resource's endpoint array. An endpoint
 * added to `post` is an edit to `post/http.ts` and nothing else, so two
 * changes to different resources do not collide; a whole resource is one line
 * in `PublicApiGroups` below.
 *
 * Both middleware are applied to each group because they must be: `middleware`
 * on either builder rewrites only the endpoints present at the call, so a
 * single `.middleware(...)` on the API would have to come after every group is
 * added, and a handler could then no longer be typed against the group it
 * implements — `HandlerOf` reads the failures of a group's middleware from the
 * group's own endpoints, and every operation is wrapped in
 * `requirePublicApiScope`, which fails with the key middleware's
 * `FORBIDDEN_SCOPE`. The price is that a seventh group has to repeat the two
 * lines; `api-contract.test.ts` fails if it does not.
 *
 * Each group also carries a `Description` annotation. The document derives a
 * `tags` entry per group — the `Title` annotation if it carries one, the group
 * identifier otherwise — and this annotation is what puts a one-line summary
 * under the section in the published reference rather than leaving it bare.
 */
export class PublicApiBoardGroup extends HttpApiGroup.make("Boards")
  .annotate(
    OpenApi.Description,
    "Read the workspace's boards and their slugs, so a post can be filed under one."
  )
  .add(...boardEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiChangelogGroup extends HttpApiGroup.make("Changelog")
  .annotate(
    OpenApi.Description,
    "Create, publish, edit, and delete the workspace's changelog entries. Reads include drafts and scheduled entries."
  )
  .add(...changelogEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiCommentGroup extends HttpApiGroup.make("Comments")
  .annotate(
    OpenApi.Description,
    "Read, create, edit, and delete comments on posts, and pin one comment per post."
  )
  .add(...commentEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiCompanyGroup extends HttpApiGroup.make("Companies")
  .annotate(
    OpenApi.Description,
    "Read, create, edit, and delete the workspace's companies — records about its own customers, so a key needs the CRM capability for these endpoints."
  )
  .add(...companyEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiPostGroup extends HttpApiGroup.make("Posts")
  .annotate(
    OpenApi.Description,
    "Read, create, edit, and delete posts, and set which tags a post carries."
  )
  .add(...postEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiPostStatusGroup extends HttpApiGroup.make("Statuses")
  .annotate(
    OpenApi.Description,
    "Read the workspace's post statuses, so a post can be filed with one."
  )
  .add(...statusEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiTagGroup extends HttpApiGroup.make("Tags")
  .annotate(
    OpenApi.Description,
    "Read, create, rename, and delete the workspace's tags."
  )
  .add(...tagEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

/**
 * Every resource group, in document order.
 *
 * Exported so the contract tests walk the same set the API is built from: a
 * group present in one and missing from the other would otherwise be invisible
 * to them.
 */
export const PublicApiGroups = [
  PublicApiBoardGroup,
  PublicApiChangelogGroup,
  PublicApiCommentGroup,
  PublicApiCompanyGroup,
  PublicApiPostGroup,
  PublicApiPostStatusGroup,
  PublicApiTagGroup,
] as const;

/**
 * The Public API's own `HttpApi` instance.
 *
 * Separate from the dashboard's `Api` so the published contract is curated
 * rather than a projection of internal endpoints: the spec served at
 * `/api/v1/openapi.json` describes exactly these endpoints, and the
 * dashboard's spec stays dev-only.
 */
export class PublicApi extends HttpApi.make("PublicApi")
  /**
   * The document's `info` block. Generated defaults name it `Api` at `0.0.1`,
   * which a customer cannot resolve against anything. Title and description
   * are what the reference page shows above the sidebar; the version is the
   * path prefix, not an npm-style counter — `/api/v1` is this document, and
   * `/api/v2` will be its own.
   */
  .annotate(OpenApi.Title, "Feeblo Public API")
  .annotate(
    OpenApi.Description,
    "Read and manage a workspace's posts, comments, tags, changelog entries, and companies. Every request is authenticated with an API key presented in the x-api-key header; the response is always JSON and errors carry a machine-readable code in `_tag`."
  )
  .annotate(OpenApi.Version, "1.0.0")
  .add(...PublicApiGroups)
  .prefix("/api/v1") {}

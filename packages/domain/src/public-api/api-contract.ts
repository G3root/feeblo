import * as HttpApi from "effect/unstable/httpapi/HttpApi";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";

import { changelogEndpoints } from "../changelog/public-api/http";
import { commentEndpoints } from "../comments/public-api/http";
import { companyEndpoints } from "../company/public-api/http";
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
 * `FORBIDDEN_SCOPE`. The price is that a sixth group has to repeat the two
 * lines; `api-contract.test.ts` fails if it does not.
 */
export class PublicApiChangelogGroup extends HttpApiGroup.make("Changelog")
  .add(...changelogEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiCommentGroup extends HttpApiGroup.make("Comments")
  .add(...commentEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiCompanyGroup extends HttpApiGroup.make("Companies")
  .add(...companyEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiPostGroup extends HttpApiGroup.make("Posts")
  .add(...postEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApiTagGroup extends HttpApiGroup.make("Tags")
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
  PublicApiChangelogGroup,
  PublicApiCommentGroup,
  PublicApiCompanyGroup,
  PublicApiPostGroup,
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
  .add(...PublicApiGroups)
  .prefix("/api/v1") {}

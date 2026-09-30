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
 * The Public API's own `HttpApi` instance.
 *
 * Separate from the dashboard's `Api` so the published contract is curated
 * rather than a projection of internal endpoints: the spec served at
 * `/api/v1/openapi.json` describes exactly these endpoints, and the
 * dashboard's spec stays dev-only.
 *
 * The group is a composition of per-resource endpoint arrays. An endpoint
 * added to `post` is an edit to `post/http.ts` and nothing else, so two
 * changes to different resources do not collide in this file; a whole resource
 * is the one line below that names it.
 */
export class PublicApiV1Group extends HttpApiGroup.make("PublicApiV1")
  .add(...changelogEndpoints)
  .add(...commentEndpoints)
  .add(...companyEndpoints)
  .add(...postEndpoints)
  .add(...tagEndpoints)
  .middleware(PublicApiSchemaErrorHandler)
  .middleware(ApiKeyAuthMiddleware) {}

export class PublicApi extends HttpApi.make("PublicApi")
  .add(PublicApiV1Group)
  .prefix("/api/v1") {}

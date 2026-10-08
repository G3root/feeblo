import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as OpenApi from "effect/http-api/OpenApi";

import type { PublicApiPostStatusGroup } from "../../public-api/api-contract";
import { PUBLIC_API_ERROR_SCHEMAS } from "../../public-api/errors";
import type { HandlerOf } from "../../public-api/handler";
import type { PublicApiCaller } from "../../public-api/middleware";
import type { PublicApiDependencies } from "../../public-api/operations";
import { listStatusesOperation } from "./operations";
import { PublicApiStatusList } from "./schema";

/** The composed group, so a handler is typed with the group's middleware. */
type PublicApiGroup = InstanceType<typeof PublicApiPostStatusGroup>;

/**
 * The status endpoints, and their HTTP implementations.
 *
 * The declarations are the published contract — paths, parameters, statuses,
 * and OpenAPI prose — and the handler does only the HTTP-specific work of
 * delegating to the operation, so the MCP projection calls the same code
 * without an HTTP request in between.
 */

export const statusEndpoints = [
  HttpApiEndpoint.get("listStatuses", "/statuses", {
    success: PublicApiStatusList,
    error: PUBLIC_API_ERROR_SCHEMAS,
  })
    .annotate(OpenApi.Title, "List Statuses")
    .annotate(OpenApi.Summary, "List the workspace's post statuses")
    .annotate(
      OpenApi.Description,
      "Returns every status of the calling workspace in display order, so a caller knows the `statusId` a post may be created or moved with and the label each one renders as. Not paginated: the catalog is small and ordered by the workspace's own `orderIndex`, not by age."
    ),
] as const;

export const statusHandlers = (
  context: Context.Context<PublicApiDependencies>
) => ({
  listStatuses: (() =>
    listStatusesOperation
      .handler({})
      .pipe(Effect.provideContext(context))) satisfies HandlerOf<
    PublicApiGroup,
    "listStatuses",
    PublicApiCaller
  >,
});

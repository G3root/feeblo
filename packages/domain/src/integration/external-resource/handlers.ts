import * as Effect from "effect/Effect";

import * as Policy from "../../policy";
import { ExternalResourceRpcs } from "./rpcs";
import { ExternalResourceService } from "./service";

/** Authorizes external-resource link reads at the integration-management boundary. */
export const ExternalResourceRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* ExternalResourceService;
  return {
    PostExternalResourceLinkList: (
      input: Parameters<typeof service.listPostLinks>[0]
    ) =>
      service
        .listPostLinks(input)
        .pipe(
          Policy.withPolicy(
            Policy.canPermission(input.organizationId, "integrations.manage")
          )
        ),
  };
});

export const ExternalResourceRpcHandlers = ExternalResourceRpcs.toLayer(
  ExternalResourceRpcHandlersEffect
);

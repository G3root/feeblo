import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { WorkspaceRepository } from "../workspace/repository";
import { SitePolicy } from "./policies";
import { SiteRepository } from "./repository";
import { SiteRpcs } from "./rpcs";
import type {
  TSiteHidePoweredByBranding,
  TSiteList,
  TSiteListBySubdomain,
  TSiteUpdate,
} from "./schema";

export const SiteRpcHandlers = SiteRpcs.toLayer(
  Effect.gen(function* () {
    const repository = yield* SiteRepository;
    const sitePolicy = yield* SitePolicy;

    return {
      SiteList: (args: TSiteList) =>
        repository
          .findMany({
            organizationId: args.organizationId,
            limit: 1,
          })
          .pipe(
            Policy.withPolicy(Policy.hasMembership(args.organizationId)),
            withRemapDbErrors("Site", "select")
          ),
      SiteListBySubdomain: (args: TSiteListBySubdomain) =>
        repository
          .findMany({
            subdomain: args.subdomain,
            limit: 1,
          })
          .pipe(withRemapDbErrors("Site", "select")),
      SiteUpdate: (args: TSiteUpdate) =>
        repository
          .update(args)
          .pipe(
            Policy.withPolicy(
              Policy.all(
                Policy.hasMembership(args.organizationId),
                Policy.any(
                  Policy.hasOrganizationRole(args.organizationId, "owner"),
                  Policy.hasOrganizationRole(args.organizationId, "admin")
                )
              )
            ),
            withRemapDbErrors("Site", "update")
          ),
      SiteHidePoweredByBranding: (args: TSiteHidePoweredByBranding) =>
        repository.updateHidePoweredByBranding(args).pipe(
          Policy.withPolicy(
            Policy.all(
              Policy.hasMembership(args.organizationId),
              Policy.any(
                Policy.hasOrganizationRole(args.organizationId, "owner"),
                Policy.hasOrganizationRole(args.organizationId, "admin")
              ),
              sitePolicy.canHidePoweredByBranding({
                organizationId: args.organizationId,
                hidePoweredBy: args.hidePoweredBy,
              })
            )
          ),
          withRemapDbErrors("Site", "update")
        ),
    };
  })
).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer)
);

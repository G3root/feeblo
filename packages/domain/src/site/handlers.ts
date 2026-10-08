import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { WorkspaceRepository } from "../workspace/repository";
import { SitePolicy } from "./policies";
import { SiteRepository } from "./repository";
import { SiteRpcs } from "./rpcs";
import type {
  TSite,
  TSiteHidePoweredByBranding,
  TSiteList,
  TSiteListBySubdomain,
  TSiteUpdate,
} from "./schema";

export const SiteRpcHandlersEffect = Effect.gen(function* () {
  const repository = yield* SiteRepository;
  const sitePolicy = yield* SitePolicy;
  const entitlementPolicy = yield* EntitlementPolicy;

  /**
   * `hidePoweredBy` is a paid capability, and the stored flag is only a
   * preference — the plan decides. Deriving it at the projection means a
   * downgrade cannot leave the branding hidden through a stale row, and the
   * dashboard's settings toggle reports what the plan currently allows
   * instead of a preference the public surface would ignore.
   */
  const applyBrandingEntitlement = (site: TSite) =>
    Effect.gen(function* () {
      const mayRemoveBranding = yield* entitlementPolicy.mayRemoveBranding(
        site.organizationId
      );
      return mayRemoveBranding ? site : { ...site, hidePoweredBy: false };
    });

  return {
    SiteList: (args: TSiteList) =>
      Effect.gen(function* () {
        const sites = yield* repository.findMany({
          organizationId: args.organizationId,
          limit: 1,
        });
        const site = sites[0];
        if (site === undefined) {
          return [];
        }
        return [yield* applyBrandingEntitlement(site)];
      }).pipe(
        Policy.withPolicy(Policy.hasMembership(args.organizationId)),
        withRemapDbErrors("Site", "select")
      ),
    SiteListBySubdomain: (args: TSiteListBySubdomain) =>
      Effect.gen(function* () {
        const sites = yield* repository.findMany({
          subdomain: args.subdomain,
          limit: 1,
        });
        const site = sites[0];
        if (site === undefined) {
          return [];
        }

        // The projection every public surface renders through.
        return [yield* applyBrandingEntitlement(site)];
      }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "SiteListBySubdomain",
          level: "read",
        }),
        withRemapDbErrors("Site", "select")
      ),
    SiteUpdate: (args: TSiteUpdate) =>
      repository
        .update(args)
        .pipe(
          Policy.withPolicy(sitePolicy.canManageSite(args.organizationId)),
          withRemapDbErrors("Site", "update")
        ),
    SiteHidePoweredByBranding: (args: TSiteHidePoweredByBranding) =>
      repository.updateHidePoweredByBranding(args).pipe(
        Policy.withPolicy(
          sitePolicy.canHidePoweredByBranding({
            organizationId: args.organizationId,
            hidePoweredBy: args.hidePoweredBy,
          })
        ),
        withRemapDbErrors("Site", "update")
      ),
  };
});

export const SiteRpcHandlers = SiteRpcs.toLayer(SiteRpcHandlersEffect).pipe(
  Layer.provide(SitePolicy.layer),
  Layer.provide(EntitlementPolicy.layer),
  Layer.provide(WorkspaceRepository.layer),
  Layer.provide(SiteRepository.layer)
);

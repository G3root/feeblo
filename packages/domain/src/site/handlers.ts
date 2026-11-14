import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { WorkspaceRepository } from "../workspace/repository";
import { SitePolicy } from "./policies";
import { SiteRepository } from "./repository";
import { SiteRpcs } from "./rpcs";
import type {
  TSite,
  TSiteHidePoweredByBranding,
  TSiteList,
  TSiteSubdomainList,
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
    ListSites: (args: TSiteList) =>
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
    ListSiteSubdomains: (args: TSiteSubdomainList) =>
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
          name: "ListSiteSubdomains",
          level: "read",
        }),
        withRemapDbErrors("Site", "select")
      ),
    UpdateSite: (args: TSiteUpdate) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.update(args);
            // The site row is the workspace's settings, which the catalog
            // models as a singleton: no `resourceId`, and the site id rides in
            // `metadata`. The update returns nothing, so the new values go in
            // `metadata` rather than posing as a diff with an empty `before`.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "workspace.updated",
              metadata: {
                siteId: args.id,
                name: args.name,
                changelogVisibility: args.changelogVisibility,
                roadmapVisibility: args.roadmapVisibility,
                noIndex: args.noIndex,
              },
            });
          })
        );
      }).pipe(
        Policy.withPolicy(sitePolicy.canManageSite(args.organizationId)),
        withRemapDbErrors("Site", "update")
      ),
    HideSitePoweredByBranding: (args: TSiteHidePoweredByBranding) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* repository.updateHidePoweredByBranding(args);
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "workspace.updated",
              metadata: {
                siteId: args.id,
                hidePoweredBy: args.hidePoweredBy,
              },
            });
          })
        );
      }).pipe(
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
  Layer.provide(SiteRepository.layer),
  Layer.provide(AuditLogRecorder.layer)
);

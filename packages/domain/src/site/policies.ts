import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import { EntitlementPolicy } from "../entitlement/policies";
import * as Policy from "../policy";
import { SiteRepository } from "./repository";

type TCanHidePoweredByBranding = {
  organizationId: string;
  hidePoweredBy: boolean;
};

const makeSitePolicy = Effect.gen(function* () {
  const entitlementPolicy = yield* EntitlementPolicy;
  const siteRepository = yield* SiteRepository;

  const canManageSite = (organizationId: string) =>
    Policy.all(
      Policy.hasMembership(organizationId),
      Policy.canPermission(organizationId, "site.*")
    );

  const canHidePoweredByBranding = (args: TCanHidePoweredByBranding) =>
    Policy.all(
      canManageSite(args.organizationId),
      entitlementPolicy.canHidePoweredByBranding(args)
    );

  const canViewChangelog = (organizationId: string) =>
    Effect.gen(function* () {
      const site = yield* siteRepository.findByOrganizationId({
        organizationId,
      });

      if (Option.isNone(site) || site.value.changelogVisibility !== "PUBLIC") {
        return yield* new Policy.PolicyDeniedError({
          reason: "Changelog is not publicly visible.",
        });
      }
    });

  const canViewRoadmap = (organizationId: string) =>
    Effect.gen(function* () {
      const site = yield* siteRepository.findByOrganizationId({
        organizationId,
      });

      if (Option.isNone(site) || site.value.roadmapVisibility !== "PUBLIC") {
        return yield* new Policy.PolicyDeniedError({
          reason: "Roadmap is not publicly visible.",
        });
      }
    });

  /**
   * The help center's portal gate.
   *
   * Same shape as the changelog and roadmap gates, and deliberately not
   * "is there a site row": a workspace with no site has no portal at all, so
   * `None` must read as hidden rather than as an unrestricted default.
   */
  const canViewHelpCenter = (organizationId: string) =>
    Effect.gen(function* () {
      const site = yield* siteRepository.findByOrganizationId({
        organizationId,
      });

      if (Option.isNone(site) || site.value.helpCenterVisibility !== "PUBLIC") {
        return yield* new Policy.PolicyDeniedError({
          reason: "Help center is not publicly visible.",
        });
      }
    });

  return {
    canManageSite,
    canHidePoweredByBranding,
    canViewChangelog,
    canViewRoadmap,
    canViewHelpCenter,
  };
});

export class SitePolicy extends Context.Service<SitePolicy>()("SitePolicy", {
  make: makeSitePolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}

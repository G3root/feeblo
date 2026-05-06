import { Context, Effect, Layer, Option } from "effect";
import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "../workspace/repository";
import { SiteRepository } from "./repository";

type TCanHidePoweredByBranding = {
  organizationId: string;
  hidePoweredBy: boolean;
};

const makeSitePolicy = Effect.gen(function* () {
  const workspaceRepository = yield* WorkspaceRepository;
  const siteRepository = yield* SiteRepository;

  const canHidePoweredByBranding = (args: TCanHidePoweredByBranding) =>
    Effect.gen(function* () {
      if (!args.hidePoweredBy) {
        return;
      }

      const planState = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: args.organizationId,
      });

      if (!PLAN_ENTITLEMENTS[planState.plan].whitelist) {
        return yield* new Policy.PolicyDeniedError({
          reason:
            "Hiding powered by branding requires the Starter plan or higher.",
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

  return { canHidePoweredByBranding, canViewRoadmap, canViewChangelog };
});

export class SitePolicy extends Context.Service<SitePolicy>()("SitePolicy", {
  make: makeSitePolicy,
}) {
  static readonly layer = Layer.effect(this, this.make);
}

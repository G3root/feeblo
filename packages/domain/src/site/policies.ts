import { Effect } from "effect";
import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "../workspace/repository";

type TCanHidePoweredByBranding = {
  organizationId: string;
  hidePoweredBy: boolean;
};

const makeSitePolicy = Effect.gen(function* () {
  const workspaceRepository = yield* WorkspaceRepository;

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

  return { canHidePoweredByBranding };
});

export class SitePolicy extends Effect.Service<SitePolicy>()("SitePolicy", {
  effect: makeSitePolicy,
  dependencies: [WorkspaceRepository.Default],
}) {
  static readonly layer = this.Default;
}

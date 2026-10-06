import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "./repository";

type TCanCreateWorkspace = {
  userId: string;
};

const makeWorkspacePolicy = Effect.gen(function* () {
  const repository = yield* WorkspaceRepository;

  /**
   * A user may own at most the Free plan's limit of free workspaces.
   *
   * Paid workspaces are not counted and do not raise the cap; upgrading one
   * of the free workspaces frees a slot. The count is only authoritative
   * under `WorkspaceRepository.lockUser`, which is why the caller runs this
   * inside the create transaction after taking that lock.
   */
  const canCreateWorkspace = ({ userId }: TCanCreateWorkspace) =>
    Effect.gen(function* () {
      const organizationIds =
        yield* repository.findOwnedOrganizationIds(userId);

      const plans = yield* Effect.forEach(organizationIds, (organizationId) =>
        repository.findPlanByOrganizationId({ organizationId })
      );

      const limit = PLAN_ENTITLEMENTS.free.limits.workspaces;
      const freeOwned = plans.filter(({ plan }) => plan === "free").length;

      if (limit !== null && freeOwned >= limit) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The Free plan allows up to ${limit} workspaces per owner. Upgrade a workspace to create more.`,
        });
      }
    });

  return { canCreateWorkspace };
});

export class WorkspacePolicy extends Context.Service<WorkspacePolicy>()(
  "WorkspacePolicy",
  {
    make: makeWorkspacePolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

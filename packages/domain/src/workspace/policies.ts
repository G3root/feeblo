import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { PLAN_ENTITLEMENTS } from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "./repository";

type TCanCreateWorkspace = {
  userId: string;
};

const workspaceLimitReason = (limit: number) =>
  `The Free plan allows up to ${limit} workspaces per owner. Upgrade a workspace to create more.`;

const makeWorkspacePolicy = Effect.gen(function* () {
  const repository = yield* WorkspaceRepository;

  /**
   * Whether the user may create another workspace, why not when they may
   * not, and the free workspaces the decision counted.
   *
   * Paid workspaces are not counted and do not raise the cap; upgrading one
   * of the free workspaces frees a slot. The count is only authoritative
   * under `WorkspaceRepository.lockUser`, which is why the create handler
   * runs this inside the create transaction after taking that lock. The
   * read-only state surface calls it unlocked.
   */
  const getCreationState = ({ userId }: TCanCreateWorkspace) =>
    Effect.gen(function* () {
      const owned = yield* repository.findOwnedWorkspaces(userId);

      const withPlans = yield* Effect.forEach(owned, (workspace) =>
        repository
          .findPlanByOrganizationId({ organizationId: workspace.id })
          .pipe(Effect.map(({ plan }) => ({ ...workspace, plan })))
      );

      const freeWorkspaces = withPlans
        .filter(({ plan }) => plan === "free")
        .map(({ id, name }) => ({ id, name }));

      const limit = PLAN_ENTITLEMENTS.free.limits.workspaces;

      if (limit === null || freeWorkspaces.length < limit) {
        return { canCreate: true, reason: null, freeWorkspaces } as const;
      }

      return {
        canCreate: false,
        reason: workspaceLimitReason(limit),
        freeWorkspaces,
      } as const;
    });

  const canCreateWorkspace = (args: TCanCreateWorkspace) =>
    getCreationState(args).pipe(
      Effect.flatMap((state) =>
        state.canCreate
          ? Effect.void
          : Effect.fail(
              new Policy.PolicyDeniedError({
                reason: state.reason ?? undefined,
              })
            )
      )
    );

  return { canCreateWorkspace, getCreationState };
});

export class WorkspacePolicy extends Context.Service<WorkspacePolicy>()(
  "WorkspacePolicy",
  {
    make: makeWorkspacePolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

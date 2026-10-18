import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  PLAN_ENTITLEMENTS,
  PLAN_FEATURE_CATALOG,
  type LimitFeatureKey,
  type OrganizationPlan,
} from "../plan-entitlements";
import * as Policy from "../policy";
import { WorkspaceRepository } from "../workspace/repository";
import { PlanLockedError } from "./errors";
import {
  computePlanLockFeatureState,
  computePlanLockState,
  type PlanLockFeatureInput,
  type PlanLockResource,
  type PlanLockSelectionSubject,
} from "./lock";
import {
  findPlanLockBoard,
  findPlanLockPostBoardId,
  listPlanLockBoards,
  listPlanLockChangelogCategories,
  listPlanLockCrmEntries,
  listPlanLockPrivilegedMembers,
  listPlanLockSelection,
  replacePlanLockSelection,
} from "./repository";

type TCanCreateBoard = {
  organizationId: string;
  visibility: "PUBLIC" | "PRIVATE";
};

type TCanUpdateBoardVisibility = {
  organizationId: string;
};

type TCanHidePoweredByBranding = {
  organizationId: string;
  hidePoweredBy: boolean;
};

type TCanAssignPrivilegedRole = {
  organizationId: string;
};

type TCanCreateRoadmap = {
  organizationId: string;
  visibility: "public" | "private";
};

type TCanCreateChangelogCategory = {
  organizationId: string;
};

type TCanUpdateRoadmapVisibility = {
  organizationId: string;
};

type TCanCreateCrmEntry = {
  organizationId: string;
};

const makeEntitlementPolicy = Effect.gen(function* () {
  const workspaceRepository = yield* WorkspaceRepository;

  const findEntitlements = (organizationId: string) =>
    Effect.gen(function* () {
      const planState = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId,
      });

      return {
        ...planState,
        entitlements: PLAN_ENTITLEMENTS[planState.plan],
      };
    });

  const selectedResourceIds = (
    rows: ReadonlyArray<{
      readonly featureKey: LimitFeatureKey;
      readonly resourceId: string;
    }>,
    feature: LimitFeatureKey
  ) =>
    rows
      .filter((row) => row.featureKey === feature)
      .map(({ resourceId }) => resourceId);

  /**
   * Builds the lock state for one plan evaluation. `plan` is explicit so the
   * downgrade wizard can ask "what would lock if this workspace were free?"
   * while the workspace is still paid: the free-plan limits are the only ones
   * the gate ever applies to existing rows.
   */
  const findPlanLock = (input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly plan: OrganizationPlan;
  }) =>
    Effect.gen(function* () {
      const [
        boards,
        changelogCategories,
        crmEntries,
        privilegedMembers,
        organizationSelection,
        ownedWorkspaces,
        userSelection,
      ] = yield* Effect.all([
        listPlanLockBoards(input.organizationId),
        listPlanLockChangelogCategories(input.organizationId),
        listPlanLockCrmEntries(input.organizationId),
        listPlanLockPrivilegedMembers(input.organizationId),
        listPlanLockSelection({
          scope: "organization",
          subjectId: input.organizationId,
        }),
        workspaceRepository.findOwnedWorkspaces(input.userId),
        listPlanLockSelection({
          scope: "user",
          subjectId: input.userId,
        }),
      ]);

      // An owner is privileged but not demotable, so the keeper limit for
      // privileged members is the plan's number minus the owners already
      // holding it; their member rows are never selection candidates.
      const ownerCount = privilegedMembers.filter((member) =>
        member.role.split(",").includes("owner")
      ).length;
      const admins: readonly PlanLockResource[] = privilegedMembers
        .filter((member) => !member.role.split(",").includes("owner"))
        .map(({ id, createdAt }) => ({ id, createdAt }));

      const planLimits = PLAN_ENTITLEMENTS[input.plan].limits;
      const privilegedLimit = planLimits.privilegedMembers;

      const freeWorkspaces = yield* Effect.forEach(
        ownedWorkspaces,
        (workspace) =>
          workspaceRepository
            .findPlanByOrganizationId({ organizationId: workspace.id })
            .pipe(Effect.map(({ plan }) => ({ ...workspace, plan })))
      ).pipe(
        Effect.map((workspaces) =>
          workspaces
            .filter(({ plan }) => plan === "free")
            .map(({ id, createdAt }) => ({ id, createdAt }))
        )
      );

      const features = {
        feedbackBoards: {
          limit: planLimits.feedbackBoards,
          resources: boards,
          selectedIds: selectedResourceIds(
            organizationSelection,
            "feedbackBoards"
          ),
        },
        privilegedMembers: {
          limit:
            privilegedLimit === null
              ? null
              : Math.max(privilegedLimit - ownerCount, 0),
          resources: admins,
          selectedIds: selectedResourceIds(
            organizationSelection,
            "privilegedMembers"
          ),
        },
        changelogCategories: {
          limit: planLimits.changelogCategories,
          resources: changelogCategories,
          selectedIds: selectedResourceIds(
            organizationSelection,
            "changelogCategories"
          ),
        },
        crmEntries: {
          limit: planLimits.crmEntries,
          resources: crmEntries,
          selectedIds: selectedResourceIds(organizationSelection, "crmEntries"),
        },
        workspaces: {
          limit: planLimits.workspaces,
          resources: freeWorkspaces,
          selectedIds: selectedResourceIds(userSelection, "workspaces"),
        },
      } satisfies Record<LimitFeatureKey, PlanLockFeatureInput>;

      return computePlanLockState({ plan: input.plan, features });
    });

  /** The lock state for the workspace's current plan. */
  const getPlanLock = (input: {
    readonly organizationId: string;
    readonly userId: string;
  }) =>
    Effect.gen(function* () {
      const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: input.organizationId,
      });
      return yield* findPlanLock({ ...input, plan });
    });

  /**
   * The lock state the workspace would have on the free plan. Identical to
   * `getPlanLock` when the workspace is already free; the difference is the
   * downgrade wizard's preview while the workspace is still paid.
   */
  const getPlanLockPreview = (input: {
    readonly organizationId: string;
    readonly userId: string;
  }) => findPlanLock({ ...input, plan: "free" });

  /**
   * Replaces the keeper selection for one feature and returns the refreshed
   * lock state. The selection is validated against the *free* limits even
   * while the workspace is paid, because that is the state the choice is made
   * for: a professional workspace may keep 50 boards, but its free fallback
   * is two, and the wizard must not let the owner pick fifty keepers first.
   * Authorization (owner/admin) is the caller's policy, not this method's.
   */
  const setPlanLockSelection = (input: {
    readonly organizationId: string;
    readonly userId: string;
    readonly featureKey: LimitFeatureKey;
    readonly resourceIds: readonly string[];
  }) =>
    Effect.gen(function* () {
      const state = yield* getPlanLockPreview(input);
      const feature = state.features.find(
        (entry) => entry.feature === input.featureKey
      );

      if (feature === undefined) {
        return yield* new Policy.PolicyDeniedError({
          reason: `Unknown plan feature: ${input.featureKey}.`,
        });
      }

      const uniqueResourceIds = [...new Set(input.resourceIds)];
      const selectable = new Set([...feature.keptIds, ...feature.lockedIds]);

      if (uniqueResourceIds.some((id) => !selectable.has(id))) {
        return yield* new Policy.PolicyDeniedError({
          reason: "The selection names a resource this workspace cannot keep.",
        });
      }

      if (feature.limit !== null && uniqueResourceIds.length > feature.limit) {
        const definition = PLAN_FEATURE_CATALOG[input.featureKey];
        return yield* new Policy.PolicyDeniedError({
          reason: `Choose at most ${feature.limit} ${
            feature.limit === 1
              ? definition.singularLabel
              : definition.pluralLabel
          }.`,
        });
      }

      const subject: PlanLockSelectionSubject =
        input.featureKey === "workspaces"
          ? { scope: "user", subjectId: input.userId }
          : { scope: "organization", subjectId: input.organizationId };

      yield* replacePlanLockSelection({
        subject,
        featureKey: input.featureKey,
        resourceIds: uniqueResourceIds,
      });

      return yield* getPlanLock({
        organizationId: input.organizationId,
        userId: input.userId,
      });
    });

  /**
   * The ids a feature's free-plan lock blocks. Empty when the plan is not
   * free or the count is within the limit, so the common write path pays the
   * plan lookup and at most one list. A paid plan never locks existing rows;
   * only the fall to `free` applies the limit (`./lock.ts`).
   */
  const listLockedResourceIds = (input: {
    readonly organizationId: string;
    readonly feature: "feedbackBoards" | "changelogCategories" | "crmEntries";
  }) =>
    Effect.gen(function* () {
      const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: input.organizationId,
      });

      if (plan !== "free") {
        return new Set<string>();
      }

      const resources = yield* Effect.gen(function* () {
        switch (input.feature) {
          case "feedbackBoards":
            return yield* listPlanLockBoards(input.organizationId);
          case "changelogCategories":
            return yield* listPlanLockChangelogCategories(input.organizationId);
          case "crmEntries":
            return yield* listPlanLockCrmEntries(input.organizationId);
        }
      });
      const limit = PLAN_ENTITLEMENTS[plan].limits[input.feature];

      if (limit === null || resources.length <= limit) {
        return new Set<string>();
      }

      const selectionRows = yield* listPlanLockSelection({
        scope: "organization",
        subjectId: input.organizationId,
      });
      const featureState = computePlanLockFeatureState({
        feature: input.feature,
        limit,
        resources,
        selectedIds: selectedResourceIds(selectionRows, input.feature),
      });

      return new Set(featureState.lockedIds);
    });

  /**
   * Refuses a write to a locked board. A private board is locked by the
   * `privateBoards` capability on free regardless of the board count; a public
   * board beyond the count limit is locked wherever it sits outside the keeper
   * set. A missing board is not this check's problem: the caller's own
   * not-found handling answers it.
   *
   * `nextVisibility` is the update's target when the caller is changing
   * visibility. Publishing a private board is the one write the capability
   * lock must not refuse: it is how the owner converts a locked private board
   * into a slot-consuming public one. It still needs a free slot, so the
   * publish-and-instantly-relock surprise cannot happen.
   */
  const assertBoardWritable = (input: {
    readonly organizationId: string;
    readonly boardId: string;
    readonly nextVisibility?: "PUBLIC" | "PRIVATE";
  }) =>
    Effect.gen(function* () {
      const board = yield* findPlanLockBoard(input);

      if (board === undefined) {
        return;
      }

      const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: input.organizationId,
      });

      if (plan !== "free") {
        return;
      }

      const limit = PLAN_ENTITLEMENTS[plan].limits.feedbackBoards ?? 0;

      if (board.visibility === "PRIVATE") {
        if (input.nextVisibility !== "PUBLIC") {
          return yield* new PlanLockedError({
            feature: "privateBoards",
            message:
              "This board is private and the workspace is on the Free plan. Upgrade to make it editable again.",
          });
        }

        const publicBoards = yield* listPlanLockBoards(input.organizationId);

        if (publicBoards.length >= limit) {
          return yield* new PlanLockedError({
            feature: "feedbackBoards",
            message:
              "The Free plan has no board slot left for this board. Remove another public board first.",
          });
        }

        return;
      }

      const publicBoards = yield* listPlanLockBoards(input.organizationId);

      if (publicBoards.length <= limit) {
        return;
      }

      const selectionRows = yield* listPlanLockSelection({
        scope: "organization",
        subjectId: input.organizationId,
      });
      const lockedBoardIds = new Set(
        computePlanLockFeatureState({
          feature: "feedbackBoards",
          limit,
          resources: publicBoards,
          selectedIds: selectedResourceIds(selectionRows, "feedbackBoards"),
        }).lockedIds
      );

      if (lockedBoardIds.has(input.boardId)) {
        return yield* new PlanLockedError({
          feature: "feedbackBoards",
          message:
            "This board is read-only because the workspace has more boards than the Free plan allows. Upgrade or remove another board to use it again.",
        });
      }
    });

  /** The public boards a free workspace's slot lock blocks, for read filters. */
  const listLockedBoardIds = (organizationId: string) =>
    listLockedResourceIds({ organizationId, feature: "feedbackBoards" });

  /** Refuses a post-scoped write when the post's board is locked. */
  const assertPostBoardWritable = (input: {
    readonly organizationId: string;
    readonly postId: string;
  }) =>
    Effect.gen(function* () {
      const boardId = yield* findPlanLockPostBoardId(input);

      if (boardId === undefined) {
        return;
      }

      yield* assertBoardWritable({
        organizationId: input.organizationId,
        boardId,
      });
    });

  const assertChangelogCategoryWritable = (input: {
    readonly organizationId: string;
    readonly categoryId: string;
  }) =>
    Effect.gen(function* () {
      const lockedCategoryIds = yield* listLockedResourceIds({
        organizationId: input.organizationId,
        feature: "changelogCategories",
      });

      if (lockedCategoryIds.has(input.categoryId)) {
        return yield* new PlanLockedError({
          feature: "changelogCategories",
          message:
            "This changelog category is read-only because the workspace has more categories than the Free plan allows.",
        });
      }
    });

  const assertCrmEntryWritable = (input: {
    readonly organizationId: string;
    readonly resourceId: string;
  }) =>
    Effect.gen(function* () {
      const lockedCrmEntryIds = yield* listLockedResourceIds({
        organizationId: input.organizationId,
        feature: "crmEntries",
      });

      if (lockedCrmEntryIds.has(input.resourceId)) {
        return yield* new PlanLockedError({
          feature: "crmEntries",
          message:
            "This contact or company is read-only because the workspace has more CRM entries than the Free plan allows.",
        });
      }
    });

  const canUsePrivateBoards = (organizationId: string) =>
    Effect.gen(function* () {
      const { entitlements } = yield* findEntitlements(organizationId);

      if (!entitlements.capabilities.privateBoards) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private boards require the Starter plan or higher.",
        });
      }
    });

  const canCreateBoard = <E, R>(
    args: TCanCreateBoard & {
      boardCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (
        args.visibility === "PRIVATE" &&
        !entitlements.capabilities.privateBoards
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private boards require the Starter plan or higher.",
        });
      }

      if (
        entitlements.limits.feedbackBoards !== null &&
        (yield* args.boardCount) >= entitlements.limits.feedbackBoards
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.feedbackBoards} feedback boards.`,
        });
      }
    });

  const canUpdateBoardVisibility = (args: TCanUpdateBoardVisibility) =>
    canUsePrivateBoards(args.organizationId);

  const canUsePrivateRoadmaps = (organizationId: string) =>
    Effect.gen(function* () {
      const { entitlements } = yield* findEntitlements(organizationId);

      if (!entitlements.capabilities.privateRoadmaps) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Private roadmaps require the Starter plan or higher.",
        });
      }
    });

  const canCreateRoadmap = (args: TCanCreateRoadmap) =>
    Effect.gen(function* () {
      if (args.visibility !== "private") {
        return;
      }

      yield* canUsePrivateRoadmaps(args.organizationId);
    });

  const canUpdateRoadmapVisibility = (args: TCanUpdateRoadmapVisibility) =>
    canUsePrivateRoadmaps(args.organizationId);

  const canHidePoweredByBranding = (args: TCanHidePoweredByBranding) =>
    Effect.gen(function* () {
      if (!args.hidePoweredBy) {
        return;
      }

      const { entitlements } = yield* findEntitlements(args.organizationId);

      if (!entitlements.capabilities.removeBranding) {
        return yield* new Policy.PolicyDeniedError({
          reason:
            "Hiding powered by branding requires the Starter plan or higher.",
        });
      }
    });

  const canUseWidgetSso = (organizationId: string) =>
    Effect.gen(function* () {
      const { entitlements } = yield* findEntitlements(organizationId);

      if (!entitlements.capabilities.widgetSso) {
        return yield* new Policy.PolicyDeniedError({
          reason: "Widget SSO requires the Starter plan or higher.",
        });
      }
    });

  const canUsePublicApi = (organizationId: string) =>
    Effect.gen(function* () {
      const { entitlements } = yield* findEntitlements(organizationId);

      if (!entitlements.capabilities.publicApi) {
        return yield* new Policy.PolicyDeniedError({
          reason: "The Public API requires the Starter plan or higher.",
        });
      }
    });

  const canAssignPrivilegedRole = <E, R>(
    args: TCanAssignPrivilegedRole & {
      privilegedRoleCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (entitlements.limits.privilegedMembers === null) {
        return;
      }

      if (
        (yield* args.privilegedRoleCount) >=
        entitlements.limits.privilegedMembers
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.privilegedMembers} admin roles.`,
        });
      }
    });

  const canCreateChangelogCategory = <E, R>(
    args: TCanCreateChangelogCategory & {
      categoryCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (entitlements.limits.changelogCategories === null) {
        return;
      }

      if (
        (yield* args.categoryCount) >= entitlements.limits.changelogCategories
      ) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.changelogCategories} changelog categories.`,
        });
      }
    });

  const canCreateCrmEntry = <E, R>(
    args: TCanCreateCrmEntry & {
      crmEntryCount: Effect.Effect<number, E, R>;
    }
  ) =>
    Effect.gen(function* () {
      const { entitlements, plan } = yield* findEntitlements(
        args.organizationId
      );

      if (entitlements.limits.crmEntries === null) {
        return;
      }

      if ((yield* args.crmEntryCount) >= entitlements.limits.crmEntries) {
        return yield* new Policy.PolicyDeniedError({
          reason: `The ${plan} plan allows up to ${entitlements.limits.crmEntries} CRM entries.`,
        });
      }
    });

  /** Whether a workspace may create public changelog or post email subscriptions. */
  const mayCreatePublicEmailSubscriptions = Effect.fn(
    "EntitlementPolicy.mayCreatePublicEmailSubscriptions"
  )(function* (organizationId: string) {
    const { entitlements } = yield* findEntitlements(organizationId);
    return entitlements.capabilities.subscriberEmails;
  });

  /**
   * Whether the workspace plan includes delivery to end-user subscribers.
   *
   * Member notifications are not gated: every plan emails members. This
   * capability only decides whether the subscriber audience is allowed in
   * addition to them.
   */
  const mayEmailSubscribers = mayCreatePublicEmailSubscriptions;

  /** Whether the workspace plan permits hiding the Feeblo branding. */
  const mayRemoveBranding = Effect.fn("EntitlementPolicy.mayRemoveBranding")(
    function* (organizationId: string) {
      const { entitlements } = yield* findEntitlements(organizationId);
      return entitlements.capabilities.removeBranding;
    }
  );

  /** Whether the workspace plan permits Slack, Discord, and GitHub integrations. */
  const mayUseIntegrations = Effect.fn("EntitlementPolicy.mayUseIntegrations")(
    function* (organizationId: string) {
      const { entitlements } = yield* findEntitlements(organizationId);
      return entitlements.capabilities.integrations;
    }
  );

  /**
   * Denies new Slack, Discord, and GitHub connections on plans without the
   * integrations capability. Webhook endpoints are deliberately not gated:
   * they stay available on every plan.
   */
  const canUseIntegrations = (organizationId: string) =>
    Effect.flatMap(mayUseIntegrations(organizationId), (allowed) =>
      allowed
        ? Effect.void
        : Effect.fail(
            new Policy.PolicyDeniedError({
              reason: "Integrations require the Starter plan or higher.",
            })
          )
    );

  return {
    canCreateBoard,
    canUpdateBoardVisibility,
    canHidePoweredByBranding,
    canUseWidgetSso,
    canUsePublicApi,
    canAssignPrivilegedRole,
    canCreateRoadmap,
    canUpdateRoadmapVisibility,
    canCreateChangelogCategory,
    canCreateCrmEntry,
    mayCreatePublicEmailSubscriptions,
    mayEmailSubscribers,
    mayUseIntegrations,
    canUseIntegrations,
    mayRemoveBranding,
    getPlanLock,
    getPlanLockPreview,
    setPlanLockSelection,
    assertBoardWritable,
    assertPostBoardWritable,
    assertChangelogCategoryWritable,
    assertCrmEntryWritable,
    listLockedBoardIds,
  };
});

export class EntitlementPolicy extends Context.Service<EntitlementPolicy>()(
  "EntitlementPolicy",
  {
    make: makeEntitlementPolicy,
  }
) {
  static readonly layer = Layer.effect(this, this.make);
}

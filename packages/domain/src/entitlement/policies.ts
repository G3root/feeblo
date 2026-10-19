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
  type PlanLockFeatureState,
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
  listPlanLockWorkspaceOwnerUserIds,
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

/**
 * The limit features a resource-scoped lock applies to.
 *
 * `privilegedMembers` and `workspaces` are excluded because neither is
 * gated per resource: the first counts a workspace's admins, the second
 * counts an owner's workspaces. Both are decided elsewhere, and naming them
 * here would invite a caller to ask for a lock that does not exist.
 */
type LockableLimitFeatureKey = Exclude<
  LimitFeatureKey,
  "privilegedMembers" | "workspaces"
>;

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
   * The account the `workspaces` keeper selection belongs to.
   *
   * The cap is per owner (ADR 0013), so the selection is an owner's account
   * choice and not a workspace one. A workspace with more than one owner has
   * no single account to select against, so the choice is refused rather than
   * written under one of the owners by accident.
   */
  const resolveWorkspaceOwnerUserId = (organizationId: string) =>
    Effect.gen(function* () {
      const ownerUserIds =
        yield* listPlanLockWorkspaceOwnerUserIds(organizationId);

      if (ownerUserIds.length !== 1) {
        return yield* new Policy.PolicyDeniedError({
          reason:
            "This workspace has more than one owner, and the workspace keeper set belongs to one owner's account.",
        });
      }

      return ownerUserIds[0] ?? "";
    });

  /**
   * The owner's free workspaces, with the plan of each resolved. Paid
   * workspaces are not counted and do not raise the cap (ADR 0013), so this is
   * exactly the resource set the `workspaces` limit counts.
   *
   * The workspace being evaluated takes the plan under evaluation rather than
   * its own, so a downgrade preview counts the workspace it is about as free
   * even while it is still paid.
   */
  const listOwnedFreeWorkspaces = (input: {
    readonly organizationId: string;
    readonly plan: OrganizationPlan;
    readonly userId: string;
  }) =>
    Effect.gen(function* () {
      const ownedWorkspaces = yield* workspaceRepository.findOwnedWorkspaces(
        input.userId
      );
      const workspaces = yield* Effect.forEach(ownedWorkspaces, (workspace) =>
        workspace.id === input.organizationId
          ? Effect.succeed({ ...workspace, plan: input.plan })
          : workspaceRepository
              .findPlanByOrganizationId({ organizationId: workspace.id })
              .pipe(Effect.map(({ plan }) => ({ ...workspace, plan })))
      );

      return workspaces
        .filter(({ plan }) => plan === "free")
        .map(({ id, createdAt }) => ({ id, createdAt }));
    });

  /**
   * The `workspaces` feature over the workspace's owners.
   *
   * The cap is per owner, so a workspace with several owners has one keeper
   * set per owner and no single one of them is *the* answer. The state
   * reported is the strict one: a workspace stays usable only while every
   * owner keeps it, and a workspace any owner does not keep is locked. That is
   * the same rule the workspace lock enforces, so the plan page and the gate
   * cannot disagree.
   */
  const getWorkspacesFeatureState = (input: {
    readonly organizationId: string;
    readonly ownerUserIds: readonly string[];
    readonly plan: OrganizationPlan;
  }) =>
    Effect.gen(function* () {
      const limit = PLAN_ENTITLEMENTS[input.plan].limits.workspaces;

      const states = yield* Effect.forEach(input.ownerUserIds, (ownerUserId) =>
        Effect.gen(function* () {
          const [freeWorkspaces, userSelection] = yield* Effect.all([
            listOwnedFreeWorkspaces({
              organizationId: input.organizationId,
              plan: input.plan,
              userId: ownerUserId,
            }),
            listPlanLockSelection({
              scope: "user",
              subjectId: ownerUserId,
            }),
          ]);

          return computePlanLockFeatureState({
            feature: "workspaces",
            limit,
            resources: freeWorkspaces,
            selectedIds: selectedResourceIds(userSelection, "workspaces"),
          });
        })
      );

      // Every workspace the owners hold, and the ones all of them keep.
      const allIds = new Set<string>();
      for (const state of states) {
        for (const id of state.keptIds) allIds.add(id);
        for (const id of state.lockedIds) allIds.add(id);
      }

      const keptIds = new Set(states.at(0)?.keptIds ?? []);
      for (const state of states.slice(1)) {
        for (const id of [...keptIds]) {
          if (!state.keptIds.includes(id)) {
            keptIds.delete(id);
          }
        }
      }

      return {
        feature: "workspaces",
        limit,
        count: allIds.size,
        keptIds: [...keptIds],
        lockedIds: [...allIds].filter((id) => !keptIds.has(id)),
      } satisfies PlanLockFeatureState;
    });

  /**
   * Builds the lock state for one plan evaluation. `plan` is explicit so the
   * downgrade wizard can ask "what would lock if this workspace were free?"
   * while the workspace is still paid: the free-plan limits are the only ones
   * the gate ever applies to existing rows.
   */
  const findPlanLock = (input: {
    readonly organizationId: string;
    readonly plan: OrganizationPlan;
  }) =>
    Effect.gen(function* () {
      const [
        boards,
        changelogCategories,
        crmEntries,
        privilegedMembers,
        organizationSelection,
        ownerUserIds,
      ] = yield* Effect.all([
        listPlanLockBoards(input.organizationId),
        listPlanLockChangelogCategories(input.organizationId),
        listPlanLockCrmEntries(input.organizationId),
        listPlanLockPrivilegedMembers(input.organizationId),
        listPlanLockSelection({
          scope: "organization",
          subjectId: input.organizationId,
        }),
        listPlanLockWorkspaceOwnerUserIds(input.organizationId),
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

      const workspacesFeature = yield* getWorkspacesFeatureState({
        organizationId: input.organizationId,
        ownerUserIds,
        plan: input.plan,
      });

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
          limit: workspacesFeature.limit,
          resources: [],
          selectedIds: [],
        },
      } satisfies Record<LimitFeatureKey, PlanLockFeatureInput>;

      const state = computePlanLockState({ plan: input.plan, features });

      // The `workspaces` feature is computed over the owners above rather
      // than through the record, so its state replaces the empty one the
      // record carries.
      return {
        ...state,
        features: state.features.map((feature) =>
          feature.feature === "workspaces" ? workspacesFeature : feature
        ),
      };
    });

  /** The lock state for the workspace's current plan. */
  const getPlanLock = (input: { readonly organizationId: string }) =>
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
  const getPlanLockPreview = (input: { readonly organizationId: string }) =>
    findPlanLock({ ...input, plan: "free" });

  /**
   * Replaces the keeper selection for one feature and returns the refreshed
   * lock state. The selection is validated against the *free* limits even
   * while the workspace is paid, because that is the state the choice is made
   * for: a professional workspace may keep 50 boards, but its free fallback
   * is two, and the wizard must not let the owner pick fifty keepers first.
   * Authorization (owner/admin) is the caller's policy, not this method's.
   *
   * The subject of the selection follows the feature: an organization-scoped
   * feature selects against the workspace, and the owner-scoped `workspaces`
   * feature selects against the workspace's owner, because the cap it locks is
   * per owner rather than per workspace (ADR 0013). A workspace with more
   * than one owner has no single account to select against, so the selection
   * is refused rather than written to the wrong one.
   */
  const setPlanLockSelection = (input: {
    readonly organizationId: string;
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
          ? {
              scope: "user",
              subjectId: yield* resolveWorkspaceOwnerUserId(
                input.organizationId
              ),
            }
          : { scope: "organization", subjectId: input.organizationId };

      yield* replacePlanLockSelection({
        subject,
        featureKey: input.featureKey,
        resourceIds: uniqueResourceIds,
      });

      return yield* getPlanLock({ organizationId: input.organizationId });
    });

  /**
   * The ids a feature's free-plan lock blocks, for a plan the caller already
   * knows.
   *
   * Empty when the plan is not free or the count is within the limit, so the
   * common write path pays the plan lookup and at most one list. A paid plan
   * never locks existing rows; only the fall to `free` applies the limit
   * (`./lock.ts`).
   */
  const lockedResourceIdsForPlan = (input: {
    readonly feature: LockableLimitFeatureKey;
    readonly organizationId: string;
    readonly plan: OrganizationPlan;
  }) =>
    Effect.gen(function* () {
      if (input.plan !== "free") {
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
      const limit = PLAN_ENTITLEMENTS[input.plan].limits[input.feature];

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

  /** The ids a feature's free-plan lock blocks. */
  const listLockedResourceIds = (input: {
    readonly feature: LockableLimitFeatureKey;
    readonly organizationId: string;
  }) =>
    Effect.gen(function* () {
      const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId: input.organizationId,
      });

      return yield* lockedResourceIdsForPlan({ ...input, plan });
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

      const lockedBoardIds = yield* lockedResourceIdsForPlan({
        feature: "feedbackBoards",
        organizationId: input.organizationId,
        plan,
      });

      if (lockedBoardIds.has(input.boardId)) {
        return yield* new PlanLockedError({
          feature: "feedbackBoards",
          message:
            "This board is read-only because the workspace has more boards than the Free plan allows. Upgrade or remove another board to use it again.",
        });
      }
    });

  /**
   * Whether the workspace is the extra one for any of its owners: a free
   * workspace outside the owner's three-workspace cap (ADR 0013). A locked
   * workspace is read-only on every surface; reads, export, delete, and the
   * billing surfaces that resolve it stay open.
   */
  const isWorkspaceLocked = (organizationId: string) =>
    Effect.gen(function* () {
      const { plan } = yield* workspaceRepository.findPlanByOrganizationId({
        organizationId,
      });

      if (plan !== "free") {
        return false;
      }

      const ownerUserIds =
        yield* listPlanLockWorkspaceOwnerUserIds(organizationId);

      // The same state the plan page reports: a workspace any owner does not
      // keep is locked, so the page and the gate cannot disagree.
      const state = yield* getWorkspacesFeatureState({
        organizationId,
        ownerUserIds,
        plan: "free",
      });

      return state.lockedIds.includes(organizationId);
    });

  /**
   * Refuses a write inside a whole-workspace lock. The callers are the
   * per-feature policies; deletes stay outside it, because removing content is
   * how an over-cap owner gets back under the cap.
   */
  const assertWorkspaceWritable = (organizationId: string) =>
    Effect.gen(function* () {
      if (!(yield* isWorkspaceLocked(organizationId))) {
        return;
      }

      return yield* new PlanLockedError({
        feature: "workspaces",
        message:
          "This workspace is read-only because its owner has more free workspaces than the Free plan allows. Upgrade or delete another workspace to use it again.",
      });
    });

  /** The public boards a free workspace's slot lock blocks, for read filters. */
  const listLockedBoardIds = (organizationId: string) =>
    Effect.gen(function* () {
      // A locked workspace's every surface is offline, so every public board is
      // a locked board to the read filters.
      if (yield* isWorkspaceLocked(organizationId)) {
        const boards = yield* listPlanLockBoards(organizationId);
        return new Set(boards.map(({ id }) => id));
      }

      return yield* listLockedResourceIds({
        organizationId,
        feature: "feedbackBoards",
      });
    });

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

  /**
   * Refuses a write to a resource the feature's lock blocks.
   *
   * The one shape every resource-scoped refusal takes: the feature names the
   * lock, the message names the remedy, and the check itself is the keeper
   * math the lock state is built from.
   */
  const assertFeatureResourceWritable = (input: {
    readonly feature: LockableLimitFeatureKey;
    readonly message: string;
    readonly organizationId: string;
    readonly resourceId: string;
  }) =>
    Effect.gen(function* () {
      const lockedResourceIds = yield* listLockedResourceIds({
        feature: input.feature,
        organizationId: input.organizationId,
      });

      if (lockedResourceIds.has(input.resourceId)) {
        return yield* new PlanLockedError({
          feature: input.feature,
          message: input.message,
        });
      }
    });

  const assertChangelogCategoryWritable = (input: {
    readonly organizationId: string;
    readonly categoryId: string;
  }) =>
    assertFeatureResourceWritable({
      feature: "changelogCategories",
      message:
        "This changelog category is read-only because the workspace has more categories than the Free plan allows.",
      organizationId: input.organizationId,
      resourceId: input.categoryId,
    });

  const assertCrmEntryWritable = (input: {
    readonly organizationId: string;
    readonly resourceId: string;
  }) =>
    assertFeatureResourceWritable({
      feature: "crmEntries",
      message:
        "This contact or company is read-only because the workspace has more CRM entries than the Free plan allows.",
      organizationId: input.organizationId,
      resourceId: input.resourceId,
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
    assertWorkspaceWritable,
    isWorkspaceLocked,
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

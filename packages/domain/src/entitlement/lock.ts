import {
  LIMIT_FEATURE_KEYS,
  type LimitFeatureKey,
  type OrganizationPlan,
} from "../plan-entitlements";

/**
 * A resource a plan limit counts, in the only shape the lock math needs:
 * a stable id and the creation instant that breaks ties between resources
 * the owner has not explicitly selected.
 */
export type PlanLockResource = {
  readonly id: string;
  readonly createdAt: Date;
};

/**
 * Whose keeper selection a row belongs to. Organization-scoped features
 * (`feedbackBoards`, `changelogCategories`, `crmEntries`,
 * `privilegedMembers`) select against the workspace; the owner-scoped
 * `workspaces` feature selects against the user, because the cap it locks is
 * per owner rather than per workspace (ADR 0013).
 */
export type PlanLockSelectionSubject = {
  readonly scope: "organization" | "user";
  readonly subjectId: string;
};

/** What the lock decided for one limit feature. */
export type PlanLockFeatureState = {
  readonly feature: LimitFeatureKey;
  /**
   * How many resources of this feature stay usable. `null` means the plan
   * does not limit the feature. This is the *keeper* limit, not necessarily
   * the plan catalog's number: for `privilegedMembers` the workspace owner
   * always counts as kept, so the effective limit is the catalog value minus
   * the owner count.
   */
  readonly limit: number | null;
  /** Every resource currently counted by the feature. */
  readonly count: number;
  /** The resources that stay fully usable, in keeper order. */
  readonly keptIds: readonly string[];
  /** The resources the gate blocks: `count` minus `keptIds`. */
  readonly lockedIds: readonly string[];
};

export type PlanLockState = {
  readonly plan: OrganizationPlan;
  readonly features: readonly PlanLockFeatureState[];
};

/** One feature's inputs to `computePlanLockState`. */
export type PlanLockFeatureInput = {
  readonly limit: number | null;
  readonly resources: readonly PlanLockResource[];
  readonly selectedIds: readonly string[];
};

/**
 * The lock is a free-plan rule. Paid plans gate *new* creation through the
 * entitlement policies, but they never retroactively lock resources an
 * account already holds: a workspace that downgrades from Professional to
 * Starter keeps what it built, and only a fall to `free` applies the limits
 * to existing rows.
 */
export const planLocksResources = (plan: OrganizationPlan): boolean =>
  plan === "free";

/**
 * Oldest first, `createdAt` then `id`. The `id` term makes the order total:
 * two resources created in the same transaction (the seed imports boards in
 * one pass) must still produce the same keeper set on every read, or a
 * request could unlock a different board than the one the previous request
 * locked.
 */
export const orderLockResources = (
  resources: readonly PlanLockResource[]
): readonly PlanLockResource[] =>
  [...resources].sort(
    (left, right) =>
      left.createdAt.getTime() - right.createdAt.getTime() ||
      (left.id < right.id ? -1 : left.id === right.id ? 0 : 1)
  );

/**
 * The keeper set for one feature: the owner's explicit selection first (in
 * resource order, capped at the limit), then the oldest unselected resources
 * until the limit is full.
 *
 * Selection ids that no longer exist are ignored rather than counted, so
 * deleting a kept resource promotes the next locked one on the same read that
 * removes it. A limit of `null` or a count within the limit keeps everything.
 *
 * The resources are taken in the order `orderLockResources` gives them, so the
 * caller that already sorted does not pay for a second sort.
 */
export const computeKeptIds = (input: {
  readonly limit: number | null;
  readonly orderedResources: readonly PlanLockResource[];
  readonly selectedIds: readonly string[];
}): readonly string[] => {
  const ordered = input.orderedResources;

  if (input.limit === null) {
    return ordered.map(({ id }) => id);
  }

  const limit = Math.max(input.limit, 0);
  const selection = new Set(input.selectedIds);
  const kept: string[] = [];

  // Pass 1: the owner's choice, in stable resource order.
  for (const resource of ordered) {
    if (kept.length >= limit) {
      break;
    }
    if (selection.has(resource.id)) {
      kept.push(resource.id);
    }
  }

  // Pass 2: fill the remaining slots oldest-first.
  for (const resource of ordered) {
    if (kept.length >= limit) {
      break;
    }
    if (!selection.has(resource.id)) {
      kept.push(resource.id);
    }
  }

  return kept;
};

export const computePlanLockFeatureState = (
  input: PlanLockFeatureInput & { readonly feature: LimitFeatureKey }
): PlanLockFeatureState => {
  const ordered = orderLockResources(input.resources);
  const keptIds = computeKeptIds({
    limit: input.limit,
    orderedResources: ordered,
    selectedIds: input.selectedIds,
  });
  const kept = new Set(keptIds);

  return {
    feature: input.feature,
    limit: input.limit,
    count: input.resources.length,
    keptIds,
    lockedIds: ordered.map(({ id }) => id).filter((id) => !kept.has(id)),
  };
};

/**
 * The full lock state for one plan evaluation.
 *
 * `features` is a total record: adding a `LimitFeatureKey` makes every caller
 * fail to compile until it says how that feature's resources are gathered.
 * On a paid plan every feature keeps every resource and the state is display
 * data; on `free` the limit applies.
 */
export const computePlanLockState = (input: {
  readonly plan: OrganizationPlan;
  readonly features: Readonly<Record<LimitFeatureKey, PlanLockFeatureInput>>;
}): PlanLockState => {
  const locks = planLocksResources(input.plan);

  return {
    plan: input.plan,
    features: LIMIT_FEATURE_KEYS.map((feature): PlanLockFeatureState => {
      const featureInput = input.features[feature];

      // A paid plan is display-only: keep everything, lock nothing. The
      // keeper math is not run at all there, because its answer is discarded.
      if (!locks) {
        return {
          feature,
          limit: featureInput.limit,
          count: featureInput.resources.length,
          keptIds: orderLockResources(featureInput.resources).map(
            ({ id }) => id
          ),
          lockedIds: [],
        };
      }

      return computePlanLockFeatureState({ feature, ...featureInput });
    }),
  };
};

/**
 * Plan keys that grant paid entitlements. The literal lives here because it
 * is consumed from both sides of the `domain -> db` dependency fence:
 * `@feeblo/db/schema/billing` gates SQL on it and
 * `@feeblo/domain/plan-entitlements` owns the entitlement semantics for every
 * key listed here. The two stay in sync through `plan-entitlements.test.ts`.
 */
export const PAID_PLAN_KEYS = ["starter", "professional"] as const;

export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

/**
 * Plan features enforced as a count (as opposed to a boolean capability).
 *
 * The literal lives here because it is consumed from both sides of the
 * `domain -> db` dependency fence: `@feeblo/db/schema/feedback` types the
 * `plan_lock_selection.feature_key` column with it and cannot import
 * `@feeblo/domain`, while `@feeblo/domain/plan-entitlements` owns the
 * per-plan limits. The two stay in sync through `plan-entitlements.test.ts`.
 */
export const LIMIT_FEATURE_KEYS = [
  "feedbackBoards",
  "privilegedMembers",
  "changelogCategories",
  "crmEntries",
  "workspaces",
] as const;

export type LimitFeatureKey = (typeof LIMIT_FEATURE_KEYS)[number];

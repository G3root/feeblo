/**
 * Plan keys that grant paid entitlements. The literal lives here because it
 * is consumed from both sides of the `domain -> db` dependency fence:
 * `@feeblo/db/schema/billing` gates SQL on it and
 * `@feeblo/domain/plan-entitlements` owns the entitlement semantics for every
 * key listed here. The two stay in sync through `plan-entitlements.test.ts`.
 */
export const PAID_PLAN_KEYS = ["starter", "professional"] as const;

export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

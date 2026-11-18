import {
  type CapabilityFeatureKey,
  type LimitFeatureKey,
  PLAN_FEATURE_CATALOG,
} from "@feeblo/domain/plan-entitlements";
import type { TPlanPricing } from "@feeblo/domain/pricing/schema";

import type { PlanType } from "./plans";

/** Limits in the order the entitlement catalog declares them. */
const LIMIT_ROWS = [
  "feedbackBoards",
  "members",
  "changelogCategories",
  "helpCenterArticles",
  "crmEntries",
  "workspaces",
] as const satisfies readonly LimitFeatureKey[];

/** Capabilities in the order the entitlement catalog declares them. */
const CAPABILITY_ROWS = [
  "roadmap",
  "changelog",
  "integrations",
  "publicApi",
  "userBans",
  "subscriberEmails",
  "unlimitedEndUsers",
  "unlimitedPosts",
  "privateBoards",
  "privateRoadmaps",
  "removeBranding",
  "widgetSso",
] as const satisfies readonly CapabilityFeatureKey[];

export type PlanComparisonValue =
  | { readonly kind: "limit"; readonly limit: number | null }
  | { readonly kind: "capability"; readonly included: boolean };

export type PlanComparisonRow = {
  readonly key: string;
  readonly label: string;
  /** Aligned with the catalog's column order, as returned beside the rows. */
  readonly values: readonly PlanComparisonValue[];
};

export type PlanComparisonColumn = {
  readonly planType: PlanType;
  readonly name: string;
};

export type PlanComparison = {
  readonly columns: readonly PlanComparisonColumn[];
  readonly rows: readonly PlanComparisonRow[];
};

/**
 * Builds the side-by-side plan table from the `/api/plans` payload.
 *
 * Limits come from the same catalog the plan cards price, so the table and the
 * cards cannot disagree about an allowance, and labels come from the shared
 * entitlement vocabulary rather than a second copy of the copy.
 */
export function buildPlanComparison(
  catalog: readonly TPlanPricing[]
): PlanComparison {
  const columns = catalog.map((plan) => ({
    planType: plan.key,
    name: plan.name,
  }));

  const limitRow = (key: LimitFeatureKey): PlanComparisonRow => ({
    key,
    label: PLAN_FEATURE_CATALOG[key].pluralLabel,
    values: catalog.map((plan) => ({
      kind: "limit",
      limit: plan.limits[key],
    })),
  });

  const capabilityRow = (key: CapabilityFeatureKey): PlanComparisonRow => ({
    key,
    label: PLAN_FEATURE_CATALOG[key].label,
    values: catalog.map((plan) => ({
      kind: "capability",
      included: plan.capabilities[key],
    })),
  });

  return {
    columns,
    rows: [...LIMIT_ROWS.map(limitRow), ...CAPABILITY_ROWS.map(capabilityRow)],
  };
}

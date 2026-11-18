import {
  PLAN_DISPLAY_NAMES,
  PLAN_ENTITLEMENTS,
  PLAN_KEYS,
} from "@feeblo/domain/plan-entitlements";
import type { TPlanPricing } from "@feeblo/domain/pricing/schema";
import { describe, expect, it } from "vitest";

import { buildPlanComparison } from "./comparison";

/** The catalog a request would decode, without depending on published products. */
const catalog: readonly TPlanPricing[] = PLAN_KEYS.map((key) => ({
  key,
  name: PLAN_DISPLAY_NAMES[key],
  includesLabel: null,
  limits: PLAN_ENTITLEMENTS[key].limits,
  capabilities: PLAN_ENTITLEMENTS[key].capabilities,
  features: [],
  prices: { month: null, year: null },
}));

describe("buildPlanComparison", () => {
  it("keeps the catalog's plan order as the columns", () => {
    const { columns } = buildPlanComparison(catalog);

    expect(columns.map((column) => column.planType)).toEqual([
      "free",
      "starter",
      "professional",
    ]);
  });

  it("gives every row one value per plan", () => {
    const { columns, rows } = buildPlanComparison(catalog);

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(row.values).toHaveLength(columns.length);
    }
  });

  it("reads limit rows from the catalog, with null meaning unlimited", () => {
    const { rows } = buildPlanComparison(catalog);

    expect(rows.find((row) => row.key === "feedbackBoards")?.values).toEqual([
      { kind: "limit", limit: 2 },
      { kind: "limit", limit: 5 },
      { kind: "limit", limit: null },
    ]);
  });

  it("reads capability rows from the catalog", () => {
    const { rows } = buildPlanComparison(catalog);

    expect(rows.find((row) => row.key === "integrations")?.values).toEqual([
      { kind: "capability", included: false },
      { kind: "capability", included: true },
      { kind: "capability", included: true },
    ]);
  });

  it("labels rows from the shared entitlement vocabulary", () => {
    const { rows } = buildPlanComparison(catalog);

    expect(rows.find((row) => row.key === "helpCenterArticles")?.label).toBe(
      "Help Center Articles"
    );
    expect(rows.find((row) => row.key === "removeBranding")?.label).toBe(
      "Remove Feeblo Branding"
    );
  });
});

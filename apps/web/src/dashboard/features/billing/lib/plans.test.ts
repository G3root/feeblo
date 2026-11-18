import { describe, expect, it } from "vitest";

import { describePlanAction, describePlanPrice, type PlanCard } from "./plans";

const plan = (overrides: Partial<PlanCard> = {}): PlanCard => ({
  planType: "starter",
  name: "Starter",
  description: "For solo builders and small teams.",
  includesLabel: null,
  month: { productId: "prod_month", amount: 1800, currency: "usd" },
  year: { productId: "prod_year", amount: 18_000, currency: "usd" },
  features: [],
  ...overrides,
});

describe("describePlanPrice", () => {
  it("shows the billed amount for the chosen interval, not a monthly equivalent", () => {
    expect(describePlanPrice(plan(), "year")).toEqual({
      amount: "$180",
      suffix: "/ year",
      note: "Billed yearly · save $36 a year",
    });
    expect(describePlanPrice(plan(), "month")).toEqual({
      amount: "$18",
      suffix: "/ month",
      note: "Billed monthly",
    });
  });

  it("gives the free plan no price and no card requirement", () => {
    expect(
      describePlanPrice(
        plan({
          planType: "free",
          name: "Free",
          month: undefined,
          year: undefined,
        }),
        "year"
      )
    ).toEqual({ amount: null, suffix: null, note: "No card required" });
  });

  it("says the price is unavailable when a paid plan has no published product", () => {
    expect(describePlanPrice(plan({ year: undefined }), "year")).toEqual({
      amount: null,
      suffix: null,
      note: "Pricing unavailable",
    });
  });

  it("omits savings when the two prices are quoted in different currencies", () => {
    expect(
      describePlanPrice(
        plan({
          year: { productId: "prod_year", amount: 18_000, currency: "eur" },
        }),
        "year"
      )
    ).toEqual({ amount: "€180", suffix: "/ year", note: "Billed yearly" });
  });
});

describe("describePlanAction", () => {
  it("sends a paid workspace to the billing portal from every card", () => {
    expect(
      describePlanAction({
        currentPlanType: "starter",
        hasPaidPlan: true,
        interval: "year",
        plan: plan(),
      })
    ).toEqual({ label: "Manage billing", disabled: false });
  });

  it("disables the current plan", () => {
    expect(
      describePlanAction({
        currentPlanType: "free",
        hasPaidPlan: false,
        interval: "year",
        plan: plan({
          planType: "free",
          name: "Free",
          month: undefined,
          year: undefined,
        }),
      })
    ).toEqual({ label: "Current plan", disabled: true });
  });

  it("offers checkout for a plan with a price in the chosen interval", () => {
    expect(
      describePlanAction({
        currentPlanType: "free",
        hasPaidPlan: false,
        interval: "year",
        plan: plan(),
      })
    ).toEqual({ label: "Upgrade to Starter", disabled: false });
  });

  it("disables a plan without a price in the chosen interval", () => {
    expect(
      describePlanAction({
        currentPlanType: "free",
        hasPaidPlan: false,
        interval: "year",
        plan: plan({ year: undefined }),
      })
    ).toEqual({ label: "Unavailable", disabled: true });
  });
});

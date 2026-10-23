import { describe, expect, it } from "@effect/vitest";

import { buildPlansResponse } from "./handlers";

type PricingProduct = Parameters<typeof buildPlansResponse>[0][number];

/** A price entry as the product row's JSONB stores it, decodable or not. */
type StoredPriceEntry = object;

const monthlyStarter = (
  prices: readonly StoredPriceEntry[]
): PricingProduct => ({
  id: "prod_starter_month",
  isRecurring: true,
  recurringInterval: "month",
  metadata: { plan: "starter", variant: "monthly" },
  prices,
});

const starterMonthPrice = (response: ReturnType<typeof buildPlansResponse>) =>
  response.plans.find((plan) => plan.key === "starter")?.prices.month ?? null;

describe("buildPlansResponse", () => {
  it("reads the snake_case price rows the Polar v1 SDK stores", () => {
    const response = buildPlansResponse([
      monthlyStarter([{ price_amount: 2900, price_currency: "usd" }]),
    ]);

    expect(starterMonthPrice(response)).toEqual({
      productId: "prod_starter_month",
      amount: 2900,
      currency: "usd",
    });
  });

  it("keeps reading rows synced by the previous SDK", () => {
    const response = buildPlansResponse([
      monthlyStarter([{ priceAmount: 2900, priceCurrency: "usd" }]),
    ]);

    expect(starterMonthPrice(response)).toEqual({
      productId: "prod_starter_month",
      amount: 2900,
      currency: "usd",
    });
  });

  it("skips entries it cannot price instead of failing the catalog", () => {
    const response = buildPlansResponse([
      monthlyStarter([
        { price_amount: 0, price_currency: "usd" },
        { price_amount: 2900 },
        { nope: true },
        { price_amount: 3500, price_currency: "usd" },
      ]),
    ]);

    expect(starterMonthPrice(response)).toEqual({
      productId: "prod_starter_month",
      amount: 3500,
      currency: "usd",
    });
  });
});

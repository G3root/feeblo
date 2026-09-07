import { TTLCache } from "@isaacs/ttlcache";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import {
  PLAN_DISPLAY_NAMES,
  PLAN_ENTITLEMENTS,
  PLAN_KEYS,
} from "../plan-entitlements";
import { withRemapDbErrors } from "../rpc-errors";
import { WorkspaceRepository } from "../workspace/repository";
import { PLAN_PRICING_FEATURES } from "./features";
import type { TPlanPrice, TPlansResponse } from "./schema";

// Prices sync from Polar webhooks and rarely change, so a one-hour max-age
// is plenty fresh while stale-while-revalidate absorbs marketing-site
// traffic spikes.
const browserCacheDuration = Duration.hours(1);
const staleCacheDuration = Duration.days(1);
const plansCacheControl = [
  "public",
  `max-age=${Duration.toSeconds(browserCacheDuration)}`,
  `stale-while-revalidate=${Duration.toSeconds(staleCacheDuration)}`,
].join(", ");

const PLANS_CACHE_KEY = "plans-catalog";
const PLANS_CACHE_TTL_MS = 60_000;
const plansResponseCache = new TTLCache<string, TPlansResponse>({ max: 1 });

const withPlansHeaders = (body: TPlansResponse) =>
  HttpApiSchema.withHeaders({
    body,
    headers: { "cache-control": plansCacheControl },
  });

/** The product columns the pricing catalog needs, as synced from Polar. */
type PricingProduct = {
  id: string;
  isRecurring: boolean;
  recurringInterval: "month" | "year" | null;
  metadata: {
    plan: "starter" | "professional";
    variant: "monthly" | "yearly";
  } | null;
  prices: unknown;
};

const PolarProductPrice = Schema.Struct({
  priceAmount: Schema.Number,
  priceCurrency: Schema.String,
});

/**
 * Picks the purchasable price for one product, mirroring the dashboard rule:
 * the first positive amount wins. Price entries come from a Polar webhook
 * payload stored as JSONB, so malformed entries are skipped rather than
 * failing the whole catalog.
 */
const firstPositivePrice = (product: PricingProduct): TPlanPrice | null => {
  if (!Array.isArray(product.prices)) {
    return null;
  }

  for (const entry of product.prices) {
    const decoded = Schema.decodeUnknownOption(PolarProductPrice)(entry);
    if (decoded._tag === "Some" && decoded.value.priceAmount > 0) {
      return {
        productId: product.id,
        amount: decoded.value.priceAmount,
        currency: decoded.value.priceCurrency,
      };
    }
  }

  return null;
};

type PlanPrices = {
  month: TPlanPrice | null;
  year: TPlanPrice | null;
};

/**
 * Builds the public pricing response: static plan entitlements merged with
 * the current Polar product prices. Plans appear in PLAN_KEYS order; the
 * first unarchived recurring product for each plan and interval wins.
 */
export const buildPlansResponse = (
  products: readonly PricingProduct[]
): TPlansResponse => {
  const pricesByPlan = new Map<string, PlanPrices>();

  for (const product of products) {
    if (
      !(
        product.isRecurring &&
        product.metadata &&
        (product.recurringInterval === "month" ||
          product.recurringInterval === "year")
      )
    ) {
      continue;
    }

    const price = firstPositivePrice(product);
    if (!price) {
      continue;
    }

    const slot = pricesByPlan.get(product.metadata.plan) ?? {
      month: null,
      year: null,
    };
    if (slot[product.recurringInterval] === null) {
      slot[product.recurringInterval] = price;
      pricesByPlan.set(product.metadata.plan, slot);
    }
  }

  return {
    plans: PLAN_KEYS.map((key, index) => {
      const entitlements = PLAN_ENTITLEMENTS[key];
      const prices = pricesByPlan.get(key);
      // Plans are ordered good→best, so each higher plan is a superset of the
      // one before it and the label points at the previous plan.
      const previousKey = index > 0 ? PLAN_KEYS[index - 1] : undefined;
      return {
        key,
        name: PLAN_DISPLAY_NAMES[key],
        includesLabel: previousKey
          ? `Everything in ${PLAN_DISPLAY_NAMES[previousKey]}, plus:`
          : null,
        limits: entitlements.limits,
        capabilities: entitlements.capabilities,
        features: PLAN_PRICING_FEATURES[key],
        prices: {
          month: prices?.month ?? null,
          year: prices?.year ?? null,
        },
      };
    }),
  };
};

export const PricingHandlersEffect = Effect.gen(function* () {
  const workspaceRepository = yield* WorkspaceRepository;

  return {
    listPlans: () =>
      Effect.gen(function* () {
        // The catalog is global (no per-org filter) and products change
        // only via Polar webhooks, so memoize the built response. 60s is
        // strictly fresher than the 1h browser max-age below; it absorbs
        // origin traffic (marketing spikes, billing pages) that CDN
        // stale-while-revalidate never sees.
        const cached = plansResponseCache.get(PLANS_CACHE_KEY);
        if (cached !== undefined) {
          return withPlansHeaders(cached);
        }
        const products = yield* workspaceRepository
          .findProducts()
          .pipe(withRemapDbErrors("Product", "select"));
        const body = buildPlansResponse(products);
        plansResponseCache.set(PLANS_CACHE_KEY, body, {
          ttl: PLANS_CACHE_TTL_MS,
        });
        return withPlansHeaders(body);
      }),
  };
});

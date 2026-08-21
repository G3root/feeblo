import type { TPlanPricing } from "@feeblo/domain/pricing/schema";

export type BillingInterval = "month" | "year";
export type PlanType = "free" | "starter" | "professional";

/** A purchasable price for one plan and billing interval, from /api/plans. */
export type PlanPrice = {
  productId: string;
  amount: number;
  currency: string;
};

export type WorkspacePlan = {
  organizationId: string;
  plan: PlanType;
};

export type PlanCard = {
  planType: PlanType;
  name: string;
  description: string;
  recommended?: boolean;
  /** "Everything in Free, plus:" for higher plans; null for the first. */
  includesLabel: string | null;
  month: PlanPrice | undefined;
  year: PlanPrice | undefined;
  features: readonly { key: string; label: string }[];
};

export const PLAN_COPY = {
  free: {
    name: "Free",
    description: "For testing and getting started.",
  },
  starter: {
    name: "Starter",
    description: "For solo builders and small teams.",
  },
  professional: {
    name: "Professional",
    description: "For teams running production workflows.",
    recommended: true,
  },
} satisfies Record<
  PlanType,
  { name: string; description: string; recommended?: boolean }
>;

/**
 * Merges the public plan catalog with display copy. Catalog order (free →
 * starter → professional) is preserved; the current plan only tags which card
 * is active.
 */
export function buildPlanCards(
  catalog: readonly TPlanPricing[],
  currentPlanType: PlanType
) {
  const plans: PlanCard[] = catalog.map((plan) => ({
    planType: plan.key,
    ...PLAN_COPY[plan.key],
    includesLabel: plan.includesLabel,
    month: plan.prices.month ?? undefined,
    year: plan.prices.year ?? undefined,
    features: plan.features,
  }));

  return {
    plans,
    currentPlanType,
  };
}

export function formatMoney(priceAmount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(priceAmount / 100);
}

export function formatPlanPrice(
  price: PlanPrice | undefined,
  interval: BillingInterval
) {
  if (!price) {
    return "$0 / month";
  }

  const monthlyAmount =
    interval === "year" ? price.amount / 12 : price.amount;

  return `${formatMoney(monthlyAmount, price.currency)} / month`;
}

export const isPaidPlan = (plan?: PlanType): boolean => {
  if (!plan || plan === "free") {
    return false;
  }
  return true;
};

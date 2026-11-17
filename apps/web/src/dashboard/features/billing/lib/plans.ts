import type { TPlanPricing } from "@feeblo/domain/pricing/schema";

export type BillingInterval = "month" | "year";

export type PlanType = "free" | "starter" | "professional";

/** A purchasable price for one plan and billing interval, from /api/plans. */
export type PlanPrice = {
  productId: string;
  amount: number;
  currency: string;
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

/** The price block a plan card renders: billed amount, period, and a note. */
export type PlanPriceDescription = {
  /** Null for the free plan and for a paid plan with no published price. */
  readonly amount: string | null;
  readonly suffix: string | null;
  readonly note: string;
};

/**
 * The billed amount for one interval, not a monthly equivalent: a yearly plan
 * shows the amount charged once a year, which is what the checkout charges.
 */
export function describePlanPrice(
  plan: PlanCard,
  interval: BillingInterval
): PlanPriceDescription {
  if (plan.planType === "free") {
    return { amount: null, suffix: null, note: "No card required" };
  }

  const price = interval === "year" ? plan.year : plan.month;

  if (!price) {
    return { amount: null, suffix: null, note: "Pricing unavailable" };
  }

  const amount = formatMoney(price.amount, price.currency);
  const suffix = interval === "year" ? "/ year" : "/ month";
  let note = interval === "year" ? "Billed yearly" : "Billed monthly";

  if (interval === "year" && plan.month) {
    const savings = plan.month.amount * 12 - price.amount;

    if (savings > 0) {
      note = `Billed yearly · save ${formatMoney(savings, price.currency)} a year`;
    }
  }

  return { amount, suffix, note };
}

export type PlanCardAction = {
  readonly label: string;
  readonly disabled: boolean;
};

/**
 * What a plan card's button does, given what the workspace already pays for.
 *
 * A paid workspace changes plans in the billing portal; a free workspace can
 * only check out into a plan that has a published price for the chosen
 * interval. The current plan is never actionable.
 */
export function describePlanAction({
  currentPlanType,
  hasPaidPlan,
  interval,
  plan,
}: {
  readonly currentPlanType: PlanType;
  readonly hasPaidPlan: boolean;
  readonly interval: BillingInterval;
  readonly plan: PlanCard;
}): PlanCardAction {
  if (hasPaidPlan) {
    return { label: "Manage billing", disabled: false };
  }

  if (plan.planType === currentPlanType) {
    return { label: "Current plan", disabled: true };
  }

  const price = interval === "year" ? plan.year : plan.month;

  if (!price) {
    return { label: "Unavailable", disabled: true };
  }

  return { label: `Upgrade to ${plan.name}`, disabled: false };
}

export const isPaidPlan = (plan?: PlanType): boolean => {
  if (!plan || plan === "free") {
    return false;
  }

  return true;
};

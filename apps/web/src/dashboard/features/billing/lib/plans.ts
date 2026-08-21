import {
  getPlanFeatureRows,
  type PlanFeatureRow,
} from "@feeblo/domain/plan-entitlements";

export type BillingInterval = "month" | "year";
export type PlanType = "free" | "starter" | "professional";

export type Price = {
  priceAmount: number;
  priceCurrency: string;
};

export type WorkspaceProduct = {
  id: string;
  name: string;
  description: string | null;
  recurringInterval: BillingInterval | null;
  trialInterval: string | null;
  trialIntervalCount: number | null;
  isRecurring: boolean;
  prices: Price[];
  metadata: {
    plan: Exclude<PlanType, "free">;
    variant: "monthly" | "yearly";
  } | null;
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
  month: WorkspaceProduct | undefined;
  year: WorkspaceProduct | undefined;
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

/** Working slots for one paid plan's products, keyed by billing interval. */
type PlanProducts = {
  month: WorkspaceProduct | undefined;
  year: WorkspaceProduct | undefined;
};

export function buildPlanCards(
  products: WorkspaceProduct[],
  currentPlanType: PlanType
) {
  // Annotations (not `satisfies`) so the slots keep the declared
  // WorkspaceProduct | undefined type instead of the literal's undefined.
  const starterProducts: PlanProducts = {
    month: undefined,
    year: undefined,
  };
  const professionalProducts: PlanProducts = {
    month: undefined,
    year: undefined,
  };

  for (const product of products) {
    const plan = product.metadata?.plan;
    const interval = product.recurringInterval;

    if (!(plan && interval)) {
      continue;
    }

    if (plan === "starter") {
      starterProducts[interval] = product;
    } else {
      professionalProducts[interval] = product;
    }
  }

  const plans: PlanCard[] = [
    {
      planType: "free",
      ...PLAN_COPY.free,
      month: undefined,
      year: undefined,
    },
    {
      planType: "starter",
      ...PLAN_COPY.starter,
      ...starterProducts,
    },
    {
      planType: "professional",
      ...PLAN_COPY.professional,
      ...professionalProducts,
    },
  ];

  return {
    plans,
    currentPlanType,
  };
}

export function getPrice(product: WorkspaceProduct | undefined) {
  if (!product) {
    return null;
  }

  return product.prices.find((entry) => entry.priceAmount > 0) ?? null;
}

export function formatMoney(priceAmount: number, currency: string) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(priceAmount / 100);
}

export function formatPlanPrice(
  product: WorkspaceProduct | undefined,
  interval: BillingInterval
) {
  if (!product) {
    return interval === "month" ? "$0 / month" : "$0 / month";
  }

  const price = getPrice(product);
  if (!price) {
    return "Custom";
  }

  if (interval === "year") {
    return `${formatMoney(price.priceAmount / 12, price.priceCurrency)} / month`;
  }

  return `${formatMoney(price.priceAmount, price.priceCurrency)} / month`;
}

export const PLAN_FEATURES = {
  free: getPlanFeatureRows("free"),
  starter: getPlanFeatureRows("starter"),
  professional: getPlanFeatureRows("professional"),
} satisfies Record<PlanType, readonly PlanFeatureRow[]>;

export const isPaidPlan = (plan?: PlanType): boolean => {
  if (!plan || plan === "free") {
    return false;
  }
  return true;
};

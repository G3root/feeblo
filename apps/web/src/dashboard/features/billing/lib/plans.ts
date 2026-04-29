/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
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

export const PLAN_COPY: Record<
  PlanType,
  { name: string; description: string; recommended?: boolean }
> = {
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
};

export function buildPlanCards(
  products: WorkspaceProduct[],
  currentPlanType: PlanType
) {
  const productsByPlan: Record<
    Exclude<PlanType, "free">,
    Record<BillingInterval, WorkspaceProduct | undefined>
  > = {
    starter: { month: undefined, year: undefined },
    professional: { month: undefined, year: undefined },
  };

  for (const product of products) {
    const plan = product.metadata?.plan;
    const interval = product.recurringInterval;

    if (!(plan && interval)) {
      continue;
    }

    productsByPlan[plan][interval] = product;
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
      ...productsByPlan.starter,
    },
    {
      planType: "professional",
      ...PLAN_COPY.professional,
      ...productsByPlan.professional,
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

export function formatPlanBillingNote(
  product: WorkspaceProduct | undefined,
  interval: BillingInterval
) {
  if (!product) {
    return interval === "month" ? "No monthly charge" : "No yearly charge";
  }

  const price = getPrice(product);
  if (!price) {
    return interval === "month"
      ? "Custom monthly billing"
      : "Custom yearly billing";
  }

  if (interval === "year") {
    return `${formatMoney(price.priceAmount, price.priceCurrency)} billed yearly`;
  }

  return "Billed monthly";
}

export function getPlanDetails(
  product: WorkspaceProduct | undefined,
  interval: BillingInterval
) {
  if (!product) {
    return [
      "Basic access for trialing the workspace.",
      interval === "month" ? "No monthly charge." : "No yearly charge.",
      "Upgrade when you need paid plan features.",
    ];
  }

  return [
    product.description || "Paid workspace plan.",
    `${formatPlanBillingNote(product, interval)}.`,
    product.trialInterval && product.trialIntervalCount
      ? `${product.trialIntervalCount} ${product.trialInterval} trial included.`
      : product.isRecurring
        ? "Renews automatically until changed."
        : "One-time purchase.",
  ];
}

export type PlanFeature = {
  feature: string;
};

export const PLAN_FEATURES: Record<PlanType, PlanFeature[]> = {
  free: [
    {
      feature: "2 Feedback Boards",
    },
    {
      feature: "2 Admin Roles",
    },
    {
      feature: "Roadmap",
    },
    {
      feature: "Changelog",
    },
    {
      feature: "Unlimited End Users",
    },
    {
      feature: "Unlimited Posts",
    },
  ],
  starter: [
    {
      feature: "Everything in free",
    },
    {
      feature: "5 Feedback Boards",
    },
    {
      feature: "5 Admin Roles",
    },
    {
      feature: "Private Boards",
    },
  ],
  professional: [
    {
      feature: "Everything in starter",
    },
    {
      feature: "Unlimited Boards",
    },
    {
      feature: "Unlimited Admin Roles",
    },
  ],
};

export const isPaidPlan = (plan?: PlanType): boolean => {
  if (!plan || plan === "free") {
    return false;
  }
  return true;
};

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

export type WorkspaceSubscription = {
  productId: string;
  currentPeriodEnd: string | Date | null;
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

export function getCurrentProduct(
  products: WorkspaceProduct[],
  subscriptions: WorkspaceSubscription[]
) {
  const productById = new Map(products.map((product) => [product.id, product]));

  for (const subscription of subscriptions) {
    const product = productById.get(subscription.productId);
    if (product) {
      return product;
    }
  }

  return undefined;
}

export function buildPlanCards(
  products: WorkspaceProduct[],
  currentProduct: WorkspaceProduct | undefined
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

  const currentPlanType: PlanType = currentProduct?.metadata?.plan ?? "free";
  const currentInterval: BillingInterval =
    currentProduct?.recurringInterval ?? "month";

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
    currentInterval,
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

export function formatRenewalDate(value: string | Date | null | undefined) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function getCurrentPlanIntervalLabel(
  product: WorkspaceProduct | undefined
) {
  if (product?.recurringInterval === "month") {
    return "Monthly";
  }

  if (product?.recurringInterval === "year") {
    return "Yearly";
  }

  return "Free";
}

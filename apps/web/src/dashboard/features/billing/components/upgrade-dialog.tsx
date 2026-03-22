import {
  CheckmarkCircle02Icon,
  Clock01Icon,
  SparklesIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { Suspense, useMemo, useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "~/components/ui/field";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "~/components/ui/item";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { Switch } from "~/components/ui/switch";
import { Skeleton } from "~/components/ui/skeleton";
import { toastManager } from "~/components/ui/toast";
import { useOrganizationId } from "~/hooks/use-organization-id";
import {
  workspaceProductCollection,
  workspaceSubscriptionCollection,
} from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";
import { cn } from "~/lib/utils";
import { useUpgradePlanDialogContext } from "../dialog-stores";

type PlanFeature = {
  title: string;
  description: string;
  icon: typeof CheckmarkCircle02Icon;
};

type PlanType = "free" | "starter" | "professional";
type BillingInterval = "month" | "year";

type Price = {
  priceAmount: number;
  priceCurrency: string;
};

type PlanView = {
  planType: PlanType;
  name: string;
  description: string;
  features: PlanFeature[];
  monthlyLabel: string;
  yearlyLabel: string;
  productId: {
    month: string;
    year: string;
  };
};

const PLAN_FEATURES: Record<PlanType, PlanFeature[]> = {
  free: [
    {
      title: "Lorem ipsum dolor sit amet",
      description:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      icon: CheckmarkCircle02Icon,
    },
  ],
  starter: [
    {
      title: "Lorem ipsum dolor sit amet",
      description:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      icon: CheckmarkCircle02Icon,
    },
    {
      title: "Lorem ipsum dolor sit amet",
      description:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      icon: Clock01Icon,
    },
  ],
  professional: [
    {
      title: "Lorem ipsum dolor sit amet",
      description:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      icon: CheckmarkCircle02Icon,
    },
    {
      title: "Lorem ipsum dolor sit amet",
      description:
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
      icon: Clock01Icon,
    },
  ],
};

const PLAN_META: Record<PlanType, { name: string; description: string }> = {
  free: {
    name: "Hobby",
    description: "For casual users",
  },
  starter: {
    name: "Starter",
    description: "For small teams",
  },
  professional: {
    name: "Professional",
    description: "For growing teams",
  },
};

function formatPriceLabel(prices: Price[], interval: BillingInterval): string {
  const price = prices.find((p) => p.priceAmount > 0);
  if (!price) {
    return "Free";
  }

  const amount =
    interval === "year" ? price.priceAmount / 12 : price.priceAmount;

  const formatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: price.priceCurrency,
    maximumFractionDigits: 0,
  }).format(amount / 100);

  return `${formatted} / mo`;
}

export function UpgradePlanDialog() {
  const store = useUpgradePlanDialogContext();
  const isOpen = useSelector(store, (state) => state.context.open);

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      store.send({ type: "toggle" });
    }
  }

  return (
    <Dialog onOpenChange={handleOpenChange} open={isOpen}>
      {isOpen ? (
        <Suspense fallback={<UpgradePlanDialogSkeleton />}>
          <UpgradePlanDialogContent />
        </Suspense>
      ) : null}
    </Dialog>
  );
}

function UpgradePlanDialogContent() {
  const organizationId = useOrganizationId();

  const { data: products } = useLiveSuspenseQuery((q) =>
    q.from({ product: workspaceProductCollection })
  );

  const { data: subscriptions } = useLiveSuspenseQuery((q) =>
    q
      .from({ subscription: workspaceSubscriptionCollection })
      .join(
        { product: workspaceProductCollection },
        ({ product, subscription }) => eq(product.id, subscription.productId)
      )
      .where(({ subscription }) =>
        eq(subscription.organizationId, organizationId)
      )
  );

  const { plans, currentPlanType, currentInterval } = useMemo(() => {
    const buildPlan = (planType: Exclude<PlanType, "free">): PlanView => {
      const monthly = products.find(
        (p) => p.metadata?.plan === planType && p.recurringInterval === "month"
      );
      const yearly = products.find(
        (p) => p.metadata?.plan === planType && p.recurringInterval === "year"
      );
      return {
        planType,
        ...PLAN_META[planType],
        features: PLAN_FEATURES[planType],
        monthlyLabel: monthly
          ? formatPriceLabel(monthly.prices as Price[], "month")
          : "—",
        yearlyLabel: yearly
          ? formatPriceLabel(yearly.prices as Price[], "year")
          : "—",
        productId: {
          month: monthly?.id ?? "",
          year: yearly?.id ?? "",
        },
      };
    };

    const plans: PlanView[] = [
      {
        planType: "free",
        ...PLAN_META.free,
        features: PLAN_FEATURES.free,
        monthlyLabel: "Free",
        yearlyLabel: "Free",
        productId: {
          month: "free",
          year: "free",
        },
      },
      buildPlan("starter"),
      buildPlan("professional"),
    ];

    const currentProduct = subscriptions[0]?.product;
    const currentPlanType: PlanType = currentProduct?.metadata?.plan ?? "free";
    const currentInterval: BillingInterval =
      currentProduct?.recurringInterval ?? "month";

    return { plans, currentPlanType, currentInterval };
  }, [products, subscriptions]);

  const [selectedInterval, setSelectedInterval] =
    useState<BillingInterval>(currentInterval);
  const [selectedPlanType, setSelectedPlanType] =
    useState<PlanType>(currentPlanType);

  const selectedPlan =
    plans.find((p) => p.planType === selectedPlanType) ?? plans[0];
  const isCurrentPlan = selectedPlanType === currentPlanType;

  return (
    <DialogContent className="max-w-5xl">
      <DialogPanel scrollFade={false}>
        <div className="grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className="flex flex-col border-border bg-background lg:border-r">
            <DialogHeader className="gap-4 px-6 pt-6 pb-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <HugeiconsIcon className="h-4 w-4" icon={SparklesIcon} />
                </div>
                <div>
                  <DialogTitle>Upgrade Plan</DialogTitle>
                  <DialogDescription className="mt-1">
                    Select the plan that fits this workspace.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="flex flex-1 flex-col px-6 pb-6">
              <div className="mb-4 flex items-center justify-between gap-4">
                <div className="font-medium text-sm">Select plan:</div>
                <div className="flex items-center gap-3 rounded-full border border-border bg-muted/40 px-3 py-2 text-sm">
                  <span
                    className={cn(
                      "transition-colors",
                      selectedInterval === "month"
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    Monthly
                  </span>
                  <Switch
                    checked={selectedInterval === "year"}
                    onCheckedChange={(checked) =>
                      setSelectedInterval(checked ? "year" : "month")
                    }
                  />
                  <span
                    className={cn(
                      "transition-colors",
                      selectedInterval === "year"
                        ? "text-foreground"
                        : "text-muted-foreground"
                    )}
                  >
                    Yearly
                  </span>
                </div>
              </div>

              <RadioGroup
                className="gap-3"
                onValueChange={(value) => setSelectedPlanType(value as PlanType)}
                value={selectedPlanType}
              >
                {plans.map((plan) => {
                  const isCurrent = plan.planType === currentPlanType;
                  const priceLabel =
                    selectedInterval === "year"
                      ? plan.yearlyLabel
                      : plan.monthlyLabel;

                  return (
                    <FieldLabel htmlFor={plan.planType} key={plan.planType}>
                      <Field orientation="horizontal">
                        <RadioGroupItem id={plan.planType} value={plan.planType} />
                        <FieldContent>
                          <FieldTitle>
                            {plan.name}{" "}
                            {isCurrent ? (
                              <Badge variant="default">Current</Badge>
                            ) : null}
                          </FieldTitle>
                          <FieldDescription>{plan.description}</FieldDescription>
                        </FieldContent>
                        <div className="flex items-center">
                          <div className="text-muted-foreground">
                            {priceLabel}
                          </div>
                        </div>
                      </Field>
                    </FieldLabel>
                  );
                })}
              </RadioGroup>

              <DialogFooter className="pt-6" variant="bare">
                <UpgradePlanButton
                  isCurrentPlan={isCurrentPlan}
                  organizationId={organizationId}
                  selectedInterval={selectedInterval}
                  selectedPlan={selectedPlan}
                />
              </DialogFooter>
            </div>
          </div>

          <aside className="flex flex-col bg-muted/20 px-6 py-6">
            <div className="max-w-sm">
              <div className="font-semibold text-2xl tracking-tight">
                {selectedPlan.name}
              </div>
              <p className="mt-2 text-base text-muted-foreground">
                {selectedPlan.description}
              </p>
            </div>

            <div className="mt-10">
              <div className="font-semibold text-muted-foreground text-xs uppercase tracking-[0.22em]">
                Key benefits
              </div>
              <ItemGroup className="mt-5 gap-4">
                {selectedPlan.features.map((feature) => (
                  <Item key={feature.title} size="sm" variant="outline">
                    <ItemMedia
                      className="h-10 w-10 rounded-xl bg-muted text-muted-foreground"
                      variant="icon"
                    >
                      <HugeiconsIcon className="h-5 w-5" icon={feature.icon} />
                    </ItemMedia>
                    <ItemContent>
                      <ItemTitle>{feature.title}</ItemTitle>
                      <ItemDescription>{feature.description}</ItemDescription>
                    </ItemContent>
                  </Item>
                ))}
              </ItemGroup>
            </div>
          </aside>
        </div>
      </DialogPanel>
    </DialogContent>
  );
}

function UpgradePlanDialogSkeleton() {
  return (
    <DialogContent className="max-w-5xl">
      <DialogPanel scrollFade={false}>
        <div className="grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className="flex flex-col border-border bg-background lg:border-r">
            <DialogHeader className="gap-4 px-6 pt-6 pb-5">
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <div className="space-y-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-4 w-56" />
                </div>
              </div>
            </DialogHeader>
            <div className="space-y-4 px-6 pb-6">
              <Skeleton className="h-10 w-44 rounded-full" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-20 w-full rounded-xl" />
              <Skeleton className="h-11 w-full rounded-md" />
            </div>
          </div>
          <aside className="space-y-4 bg-muted/20 px-6 py-6">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-24 w-full rounded-xl" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </aside>
        </div>
      </DialogPanel>
    </DialogContent>
  );
}

function UpgradePlanButton({
  isCurrentPlan,
  organizationId,
  selectedPlan,
  selectedInterval,
}: {
  isCurrentPlan: boolean;
  organizationId: string;
  selectedPlan: PlanView;
  selectedInterval: BillingInterval;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      className="w-full"
      disabled={isCurrentPlan || loading}
      onClick={async () => {
        try {
          const productId = selectedPlan.productId[selectedInterval];
          if (!productId || productId === "free") {
            throw new Error("Missing product id");
          }

          setLoading(true);
          const result = await fetchRpc((rpc) =>
            rpc.BillingCheckout({
              organizationId,
              productId,
            })
          );

          window.location.href = result.url;

          setLoading(false);
        } catch (_error) {
          toastManager.add({
            title: "Failed to create checkout session.",
            type: "error",
          });
          setLoading(false);
        }
      }}
      size="lg"
      type="button"
    >
      {isCurrentPlan ? "Current Plan" : `Upgrade to ${selectedPlan.name}`}
    </Button>
  );
}

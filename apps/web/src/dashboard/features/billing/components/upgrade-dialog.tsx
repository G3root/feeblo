import type { TPlanPricing } from "@feeblo/domain/pricing/schema";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldTitle,
} from "@feeblo/ui/field";
import {
  Item,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@feeblo/ui/item";
import { Radio, RadioGroup } from "@feeblo/ui/radio-group";
import { SkeletonLoader, SkeletonWrapper } from "@feeblo/ui/skeleton-loader";
import { SparklesIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useState } from "react";

import { BillingIntervalTabs } from "~/features/billing/components/billing-interval-tabs";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlanCatalog } from "~/hooks/use-plan-catalog";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useUpgradePlanDialogContext } from "../dialog-stores";
import { startBillingCheckout, startBillingPortal } from "../lib/checkout";
import {
  type BillingInterval,
  type PlanCard,
  buildPlanCards,
  formatPlanPrice,
  PLAN_COPY,
  type PlanType,
  type WorkspacePlan,
} from "../lib/plans";

type PlanView = PlanCard & {
  productId: {
    month: string;
    year: string;
  };
};

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
      {isOpen ? <UpgradePlanDialogPopup /> : null}
    </Dialog>
  );
}

function UpgradePlanDialogPopup() {
  const organizationId = useOrganizationId();
  const { workspacePlanCollection } = useDashboardCollections();

  const catalog = usePlanCatalog();

  const { data: workspacePlans, isLoading: plansLoading } = useLiveQuery((q) =>
    q
      .from({ plan: workspacePlanCollection })
      .where(({ plan }) => eq(plan.organizationId, organizationId))
  );

  if (catalog.isPending || plansLoading) {
    return <UpgradePlanDialogSkeleton />;
  }

  if (catalog.isError) {
    return (
      <DialogPopup className="max-w-5xl">
        <DialogPanel scrollFade={false}>
          <DialogHeader className="px-6 pt-6">
            <DialogTitle>Upgrade Plan</DialogTitle>
            <DialogDescription className="mt-1">
              Plans are unavailable right now. Please try again later.
            </DialogDescription>
          </DialogHeader>
        </DialogPanel>
      </DialogPopup>
    );
  }

  return (
    <UpgradePlanDialogContent
      organizationId={organizationId}
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      catalog={catalog.data ?? []}
      workspacePlans={workspacePlans ?? []}
    />
  );
}

function UpgradePlanDialogContent({
  organizationId,
  catalog,
  workspacePlans,
}: {
  organizationId: string;
  catalog: readonly TPlanPricing[];
  workspacePlans: WorkspacePlan[];
}) {
  const currentPlanType = workspacePlans[0]?.plan ?? "free";
  const { plans: rawPlans } = buildPlanCards(catalog, currentPlanType);
  const plans: PlanView[] = rawPlans.map((plan) => ({
    ...plan,
    productId: {
      month: plan.month?.productId ?? "free",
      year: plan.year?.productId ?? "free",
    },
  }));

  const [selectedInterval, setSelectedInterval] =
    useState<BillingInterval>("year");
  const [selectedPlanType, setSelectedPlanType] =
    useState<PlanType>(currentPlanType);
  const hasPaidPlan = currentPlanType !== "free";

  const selectedPlan =
    plans.find((p) => p.planType === selectedPlanType) ?? plans[0];
  const isCurrentPlan = selectedPlanType === currentPlanType;

  return (
    <DialogPopup className="max-w-5xl">
      <DialogPanel scrollFade={false}>
        <div className="grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className="border-border flex flex-col lg:border-r">
            <DialogHeader className="gap-4 px-6 pt-6 pb-5">
              <div className="flex items-center gap-3">
                <div className="bg-primary/15 text-primary flex h-9 w-9 items-center justify-center rounded-xl">
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
                <div className="text-sm font-medium">Select plan:</div>
                <BillingIntervalTabs
                  onValueChange={setSelectedInterval}
                  value={selectedInterval}
                />
              </div>

              <RadioGroup
                className="gap-3"
                onValueChange={(value) =>
                  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
                  setSelectedPlanType(value as PlanType)
                }
                value={selectedPlanType}
              >
                {plans?.map((plan) => {
                  const isCurrent = plan.planType === currentPlanType;
                  const selectedProduct =
                    selectedInterval === "year" ? plan.year : plan.month;

                  return (
                    <Field key={plan.planType} orientation="horizontal">
                      <FieldLabel
                        className="flex flex-1 cursor-pointer items-center gap-3"
                        htmlFor={plan.planType}
                      >
                        <Radio id={plan.planType} value={plan.planType} />
                        <FieldContent>
                          <FieldTitle>
                            {plan.name}{" "}
                            {isCurrent ? (
                              <Badge variant="default">Current</Badge>
                            ) : null}
                          </FieldTitle>
                          <FieldDescription>
                            {plan.description}
                          </FieldDescription>
                        </FieldContent>
                        <div className="flex items-center">
                          <div className="text-muted-foreground">
                            {formatPlanPrice(selectedProduct, selectedInterval)}
                          </div>
                        </div>
                      </FieldLabel>
                    </Field>
                  );
                })}
              </RadioGroup>

              <DialogFooter className="pt-6" variant="bare">
                <UpgradePlanButton
                  hasPaidPlan={hasPaidPlan}
                  isCurrentPlan={isCurrentPlan}
                  organizationId={organizationId}
                  selectedInterval={selectedInterval}
                  selectedPlan={selectedPlan}
                />
              </DialogFooter>
            </div>
          </div>

          <aside className="bg-muted/20 flex flex-col px-6 py-6">
            <div className="max-w-sm">
              <div className="text-2xl font-semibold tracking-tight">
                {selectedPlan.name}
              </div>
              <p className="text-muted-foreground mt-2 text-base">
                {selectedPlan.description}
              </p>
            </div>

            {selectedPlan.includesLabel ? (
              <div className="text-muted-foreground mt-5 text-sm font-medium">
                {selectedPlan.includesLabel}
              </div>
            ) : null}

            <ItemGroup className="mt-2 gap-1">
              {selectedPlan.features.map((feature) => (
                <Item key={feature.key} size="sm" variant="outline">
                  <ItemMedia>
                    <HugeiconsIcon icon={StarIcon} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{feature.label}</ItemTitle>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </aside>
        </div>
      </DialogPanel>
    </DialogPopup>
  );
}

function UpgradePlanDialogSkeleton() {
  return (
    <DialogPopup className="max-w-5xl">
      <DialogPanel scrollFade={false}>
        <div className="grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className="border-border flex flex-col lg:border-r">
            <DialogHeader className="gap-4 px-6 pt-6 pb-5">
              <div className="flex items-center gap-3">
                <div className="bg-primary/15 text-primary flex h-9 w-9 items-center justify-center rounded-xl">
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
                <div className="text-sm font-medium">Select plan:</div>
              </div>
              <SkeletonLoader isLoading>
                <SkeletonWrapper>
                  <RadioGroup className="gap-3" value="free">
                    {Object.entries(PLAN_COPY).map(([planType, copy]) => (
                      <Field key={planType} orientation="horizontal">
                        <FieldLabel
                          className="flex flex-1 cursor-pointer items-center gap-3"
                          htmlFor={planType}
                        >
                          <Radio id={planType} value={planType} />
                          <FieldContent>
                            <FieldTitle>{copy.name}</FieldTitle>
                            <FieldDescription>
                              {copy.description}
                            </FieldDescription>
                          </FieldContent>
                        </FieldLabel>
                      </Field>
                    ))}
                  </RadioGroup>
                </SkeletonWrapper>
              </SkeletonLoader>
            </div>
          </div>
          <aside className="bg-muted/20 flex flex-col px-6 py-6">
            <SkeletonLoader isLoading>
              <SkeletonWrapper>
                <div className="max-w-sm space-y-5">
                  <div className="text-2xl font-semibold tracking-tight">
                    Loading
                  </div>
                  <p className="text-muted-foreground text-base">Loading</p>
                </div>
              </SkeletonWrapper>
            </SkeletonLoader>
          </aside>
        </div>
      </DialogPanel>
    </DialogPopup>
  );
}

function UpgradePlanButton({
  hasPaidPlan,
  isCurrentPlan,
  organizationId,
  selectedPlan,
  selectedInterval,
}: {
  hasPaidPlan: boolean;
  isCurrentPlan: boolean;
  organizationId: string;
  selectedPlan: PlanView;
  selectedInterval: BillingInterval;
}) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      className="w-full"
      disabled={
        loading ||
        (!hasPaidPlan &&
          ((selectedPlan.planType === "free" && !isCurrentPlan) ||
            isCurrentPlan))
      }
      onClick={async () => {
        try {
          if (hasPaidPlan) {
            setLoading(true);
            const didStart = await startBillingPortal({
              organizationId,
            });

            if (!didStart) {
              setLoading(false);
            }
            return;
          }

          const productId = selectedPlan.productId[selectedInterval];
          if (!productId || productId === "free") {
            throw new Error("Missing product id");
          }

          setLoading(true);
          const didStart = await startBillingCheckout({
            organizationId,
            productId,
          });

          if (!didStart) {
            setLoading(false);
          }
        } catch {
          setLoading(false);
        }
      }}
      size="lg"
      type="button"
    >
      {loading
        ? "Redirecting..."
        : hasPaidPlan
          ? "Manage Billing"
          : isCurrentPlan
            ? "Current Plan"
            : selectedPlan.planType === "free"
              ? "Unavailable"
              : `Upgrade to ${selectedPlan.name}`}
    </Button>
  );
}

/** biome-ignore-all lint/style/noNestedTernary: <explanation> */

import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
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
import { RadioGroup, RadioGroupItem } from "@feeblo/ui/radio-group";
import { SparklesIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { eq, useLiveQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { useState } from "react";
import { BillingIntervalTabs } from "~/features/billing/components/billing-interval-tabs";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useUpgradePlanDialogContext } from "../dialog-stores";
import { startBillingCheckout, startBillingPortal } from "../lib/checkout";
import {
  type BillingInterval,
  buildPlanCards,
  formatPlanPrice,
  PLAN_FEATURES,
  type PlanType,
  type WorkspacePlan,
  type WorkspaceProduct,
} from "../lib/plans";

type PlanView = {
  planType: PlanType;
  name: string;
  description: string;

  month: WorkspaceProduct | undefined;
  year: WorkspaceProduct | undefined;
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
      {isOpen ? <UpgradePlanDialogContent /> : null}
    </Dialog>
  );
}

// TODO: add loading states for products and plans
function UpgradePlanDialogContent() {
  const organizationId = useOrganizationId();
  const { workspacePlanCollection, workspaceProductCollection } =
    useDashboardCollections();

  const { data: products } = useLiveQuery((q) =>
    q.from({ product: workspaceProductCollection })
  );

  const { data: workspacePlans } = useLiveQuery((q) =>
    q
      .from({ plan: workspacePlanCollection })
      .where(({ plan }) => eq(plan.organizationId, organizationId))
  );

  const currentPlanType =
    (workspacePlans[0] as WorkspacePlan | undefined)?.plan ?? "free";
  const { plans: rawPlans } = buildPlanCards(
    (products as WorkspaceProduct[]) ?? [],
    currentPlanType
  );
  const plans: PlanView[] = rawPlans.map((plan) => ({
    ...plan,
    productId: {
      month: plan.month?.id ?? "free",
      year: plan.year?.id ?? "free",
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
    <DialogContent className="max-w-5xl">
      <DialogPanel scrollFade={false}>
        <div className="grid lg:grid-cols-[minmax(0,1.08fr)_minmax(0,0.92fr)]">
          <div className="flex flex-col border-border lg:border-r">
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
                <BillingIntervalTabs
                  onValueChange={setSelectedInterval}
                  value={selectedInterval}
                />
              </div>

              <RadioGroup
                className="gap-3"
                onValueChange={(value) =>
                  setSelectedPlanType(value as PlanType)
                }
                value={selectedPlanType}
              >
                {plans?.map((plan) => {
                  const isCurrent = plan.planType === currentPlanType;
                  const selectedProduct =
                    selectedInterval === "year" ? plan.year : plan.month;

                  return (
                    <FieldLabel htmlFor={plan.planType} key={plan.planType}>
                      <Field orientation="horizontal">
                        <RadioGroupItem
                          id={plan.planType}
                          value={plan.planType}
                        />
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
                      </Field>
                    </FieldLabel>
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

          <aside className="flex flex-col bg-muted/20 px-6 py-6">
            <div className="max-w-sm">
              <div className="font-semibold text-2xl tracking-tight">
                {selectedPlan.name}
              </div>
              <p className="mt-2 text-base text-muted-foreground">
                {selectedPlan.description}
              </p>
            </div>

            <ItemGroup className="mt-5 gap-1">
              {PLAN_FEATURES[selectedPlan.planType].map((feature) => (
                <Item
                  key={feature.feature + selectedPlan.name}
                  size="sm"
                  variant="outline"
                >
                  <ItemMedia>
                    <HugeiconsIcon icon={StarIcon} />
                  </ItemMedia>
                  <ItemContent>
                    <ItemTitle>{feature.feature}</ItemTitle>
                  </ItemContent>
                </Item>
              ))}
            </ItemGroup>
          </aside>
        </div>
      </DialogPanel>
    </DialogContent>
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
        (selectedPlan.planType === "free" && !isCurrentPlan) ||
        (isCurrentPlan && !hasPaidPlan)
      }
      onClick={async () => {
        try {
          if (isCurrentPlan && hasPaidPlan) {
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
        } catch (_error) {
          setLoading(false);
        }
      }}
      size="lg"
      type="button"
    >
      {loading
        ? "Redirecting..."
        : isCurrentPlan && hasPaidPlan
          ? "Manage Billing"
          : isCurrentPlan
            ? "Current Plan"
            : selectedPlan.planType === "free"
              ? "Unavailable"
              : `Upgrade to ${selectedPlan.name}`}
    </Button>
  );
}

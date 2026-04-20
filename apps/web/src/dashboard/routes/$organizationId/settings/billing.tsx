/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { eq, useLiveQuery } from "@tanstack/react-db";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Separator } from "~/components/ui/separator";
import { Skeleton } from "~/components/ui/skeleton";
import { BillingIntervalTabs } from "~/features/billing/components/billing-interval-tabs";
import {
  startBillingCheckout,
  startBillingPortal,
} from "~/features/billing/lib/checkout";
import {
  type BillingInterval,
  buildPlanCards,
  formatPlanPrice,
  PLAN_FEATURES,
  PLAN_COPY,
  type PlanType,
  type WorkspacePlan,
  type WorkspaceProduct,
} from "~/features/billing/lib/plans";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import {
  workspacePlanCollection,
  workspaceProductCollection,
} from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/billing")({
  component: BillingSettingsPage,
});

function BillingSettingsPage() {
  const organizationId = useOrganizationId();
  const [selectedInterval, setSelectedInterval] =
    useState<BillingInterval>("year");
  const [loadingPlanType, setLoadingPlanType] = useState<PlanType | null>(null);

  const {
    data: products = [],
    isLoading: productsLoading,
    isError: productsError,
  } = useLiveQuery((q) => q.from({ product: workspaceProductCollection }), []);

  const { data: workspacePlans = [] } = useLiveQuery(
    (q) =>
      q
        .from({ plan: workspacePlanCollection })
        .where(({ plan }) => eq(plan.organizationId, organizationId)),
    [organizationId]
  );

  const productList = products as WorkspaceProduct[];
  const currentPlanType =
    (workspacePlans[0] as WorkspacePlan | undefined)?.plan ?? "free";
  const { plans } = buildPlanCards(productList, currentPlanType);
  const currentPlan = plans.find((plan) => plan.planType === currentPlanType);
  const hasPaidPlan = currentPlanType !== "free";

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>Billing</SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          Track plan details, payment methods, and billing history.
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>
      <SettingsLayout.Content>
        <div className="space-y-6">
          <Card className="border border-border shadow-none ring-0">
            <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle>Current Plan</CardTitle>
                <CardDescription>
                  Active billing status for this workspace.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{PLAN_COPY[currentPlanType].name}</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-muted-foreground text-sm">
                    {currentPlan?.description || PLAN_COPY[currentPlanType].description}
                  </div>
                </div>
                <Separator />
                <div className="grid gap-3 sm:grid-cols-2">
                  <CurrentPlanStat
                    label="Plan"
                    value={PLAN_COPY[currentPlanType].name}
                  />
                  <CurrentPlanStat
                    label="Access"
                    value={hasPaidPlan ? "Paid workspace" : "Free workspace"}
                  />
                </div>
              </div>
              {hasPaidPlan ? (
                <div className="flex justify-start">
                  <Button
                    onClick={async () => {
                      await startBillingPortal({ organizationId });
                    }}
                    type="button"
                    variant="outline"
                  >
                    Manage Billing
                  </Button>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border border-border shadow-none ring-0">
            <CardHeader>
              <CardTitle>Available Plans</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex justify-start sm:justify-end">
                <BillingIntervalTabs
                  onValueChange={setSelectedInterval}
                  value={selectedInterval}
                />
              </div>

              {productsLoading ? (
                <PlanGridSkeleton />
              ) : productsError ? (
                <Card size="sm">
                  <CardContent className="py-2 text-muted-foreground">
                    Plans are unavailable right now.
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-3">
                  {plans.map((plan) => {
                    const selectedProduct = plan[selectedInterval];
                    const isCurrentPlan = plan.planType === currentPlanType;
                    const ctaLabel =
                      isCurrentPlan && hasPaidPlan
                        ? "Manage billing"
                        : isCurrentPlan
                          ? "Current plan"
                          : plan.planType === "free"
                            ? "Unavailable"
                            : selectedProduct
                              ? "Upgrade"
                              : "Unavailable";

                    return (
                      <Card key={plan.planType} size="sm">
                        <CardHeader className="space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                              <CardTitle>{plan.name}</CardTitle>
                              <CardDescription>
                                {selectedProduct?.description ||
                                  plan.description}
                              </CardDescription>
                            </div>
                            <div className="flex gap-2">
                              {plan.recommended ? (
                                <Badge variant="secondary">Popular</Badge>
                              ) : null}
                              {isCurrentPlan ? <Badge>Current</Badge> : null}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <div className="font-semibold text-3xl tracking-tight">
                              {formatPlanPrice(
                                selectedProduct,
                                selectedInterval
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <Separator />
                          <div className="space-y-3">
                            {PLAN_FEATURES[plan.planType].map((feature) => (
                              <div className="text-sm" key={feature.feature}>
                                {feature.feature}
                              </div>
                            ))}
                          </div>
                        </CardContent>
                        <CardFooter>
                          <Button
                            className="w-full"
                            disabled={
                              loadingPlanType !== null ||
                              (!isCurrentPlan && plan.planType === "free") ||
                              (isCurrentPlan && !hasPaidPlan) ||
                              (plan.planType !== "free" && !selectedProduct)
                            }
                            onClick={async () => {
                              if (isCurrentPlan && hasPaidPlan) {
                                setLoadingPlanType(plan.planType);
                                const didStart = await startBillingPortal({
                                  organizationId,
                                });

                                if (!didStart) {
                                  setLoadingPlanType(null);
                                }
                                return;
                              }

                              if (
                                !selectedProduct ||
                                plan.planType === "free"
                              ) {
                                return;
                              }

                              setLoadingPlanType(plan.planType);
                              const didStart = await startBillingCheckout({
                                organizationId,
                                productId: selectedProduct.id,
                              });

                              if (!didStart) {
                                setLoadingPlanType(null);
                              }
                            }}
                            type="button"
                            variant={isCurrentPlan ? "secondary" : "default"}
                          >
                            {loadingPlanType === plan.planType
                              ? "Redirecting..."
                              : ctaLabel}
                          </Button>
                        </CardFooter>
                      </Card>
                    );
                  })}
                </div>
              )}

              {hasPaidPlan ? (
                <div className="rounded-4xl border px-4 py-3 text-muted-foreground text-sm">
                  You are on the {PLAN_COPY[currentPlanType].name} plan. Use the
                  upgrade action to review plan changes and checkout options.
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

function CurrentPlanStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs uppercase tracking-wide">
        {label}
      </div>
      <div className="font-medium text-sm">{value}</div>
    </div>
  );
}

function PlanGridSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {["free", "starter", "professional"].map((key) => (
        <Card key={key} size="sm">
          <CardHeader className="space-y-3">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-28" />
          </CardHeader>
          <CardContent className="space-y-4">
            <Skeleton className="h-px w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-10/12" />
          </CardContent>
          <CardFooter>
            <Skeleton className="h-9 w-full" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

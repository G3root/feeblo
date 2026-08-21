import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Separator } from "@feeblo/ui/separator";
import { getAuthSession } from "@feeblo/web-shared/auth-session";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

import { BillingIntervalTabs } from "~/features/billing/components/billing-interval-tabs";
import {
  CurrentPlanStat,
  PlanGridSkeleton,
} from "~/features/billing/components/billing-plan-summary";
import {
  startBillingCheckout,
  startBillingPortal,
} from "~/features/billing/lib/checkout";
import {
  type BillingInterval,
  buildPlanCards,
  formatPlanPrice,
  PLAN_COPY,
  type PlanType,
} from "~/features/billing/lib/plans";
import { SettingsAccessDenied } from "~/features/settings/components/settings-access-denied";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlanCatalog } from "~/hooks/use-plan-catalog";
import { usePlan } from "~/hooks/use-plan";
import { workspacePlanCollection } from "~/lib/collections";

export const Route = createFileRoute("/$organizationId/settings/billing")({
  validateSearch: (search) =>
    z
      .object({
        checkout_id: z.string().min(1).optional(),
      })
      .parse(search),
  component: BillingSettingsPage,
  beforeLoad: async ({ params }) => {
    const session = await getAuthSession();
    if (
      session !== null &&
      hasPermission(params.organizationId, "billing.update")(session)
    ) {
      await workspacePlanCollection.preload();
    }
    return null;
  },
});

function BillingSettingsPage() {
  const organizationId = useOrganizationId();
  const { allowed: canManageBilling, isPending } = usePolicy(
    hasPermission(organizationId, "billing.update")
  );

  if (isPending) {
    return null;
  }
  if (!canManageBilling) {
    return <SettingsAccessDenied />;
  }

  return <BillingSettingsContent organizationId={organizationId} />;
}

function BillingSettingsContent({
  organizationId,
}: {
  organizationId: string;
}) {
  const search = Route.useSearch();
  const [selectedInterval, setSelectedInterval] =
    useState<BillingInterval>("year");
  const [loadingPlanType, setLoadingPlanType] = useState<PlanType | null>(null);
  const [confirmationStatus, setConfirmationStatus] = useState<
    "pending" | "delayed" | "error"
  >("pending");

  const catalog = usePlanCatalog();

  const currentSubscribedPlan = usePlan();
  const currentPlanType = currentSubscribedPlan.data?.plan ?? "free";
  const { plans } = buildPlanCards(catalog.data ?? [], currentPlanType);
  const currentPlan = plans.find((plan) => plan.planType === currentPlanType);
  const hasPaidPlan = currentPlanType !== "free";

  useEffect(() => {
    if (!(search.checkout_id && !hasPaidPlan)) {
      return;
    }

    setConfirmationStatus("pending");
    let attempts = 0;
    const timer = window.setInterval(() => {
      attempts += 1;
      workspacePlanCollection.utils
        .refetch()
        .catch(() => setConfirmationStatus("error"));
      if (attempts >= 10) {
        window.clearInterval(timer);
        setConfirmationStatus("delayed");
      }
    }, 3000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasPaidPlan, search.checkout_id]);

  const refreshCheckoutConfirmation = async () => {
    setConfirmationStatus("pending");
    try {
      await workspacePlanCollection.utils.refetch();
      setConfirmationStatus("delayed");
    } catch {
      setConfirmationStatus("error");
    }
  };

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
          {search.checkout_id ? (
            <Alert
              variant={
                hasPaidPlan
                  ? "success"
                  : confirmationStatus === "error"
                    ? "error"
                    : "info"
              }
            >
              <AlertTitle>
                {hasPaidPlan
                  ? "Subscription activated"
                  : confirmationStatus === "delayed"
                    ? "Subscription confirmation is taking longer than expected"
                    : confirmationStatus === "error"
                      ? "Could not refresh subscription status"
                      : "Checkout completed — confirming your subscription"}
              </AlertTitle>
              <AlertDescription>
                {hasPaidPlan
                  ? `This workspace now has the ${PLAN_COPY[currentPlanType].name} plan.`
                  : confirmationStatus === "pending"
                    ? "Polar is confirming the subscription. This page will update automatically; it can take a few seconds."
                    : "Your checkout may still be processing. Refresh the subscription status to try again."}
              </AlertDescription>
              {!hasPaidPlan && confirmationStatus !== "pending" ? (
                <Button
                  className="mt-3"
                  onClick={refreshCheckoutConfirmation}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  Refresh status
                </Button>
              ) : null}
            </Alert>
          ) : null}
          <Card className="border-border border shadow-none ring-0">
            <CardHeader className="gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle>Current Plan</CardTitle>
                <CardDescription>
                  Active billing status for this workspace.
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">
                  {PLAN_COPY[currentPlanType].name}
                </Badge>
              </div>
            </CardHeader>
            <CardPanel className="grid gap-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="text-muted-foreground text-sm">
                    {currentPlan?.description ||
                      PLAN_COPY[currentPlanType].description}
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
            </CardPanel>
          </Card>

          <Card className="border-border border shadow-none ring-0">
            <CardHeader>
              <CardTitle>Available Plans</CardTitle>
            </CardHeader>
            <CardPanel className="space-y-6">
              <div className="flex justify-start sm:justify-end">
                <BillingIntervalTabs
                  onValueChange={setSelectedInterval}
                  value={selectedInterval}
                />
              </div>

              {catalog.isPending ? (
                <PlanGridSkeleton />
              ) : catalog.isError ? (
                <Card size="sm">
                  <CardPanel className="text-muted-foreground py-2">
                    Plans are unavailable right now.
                  </CardPanel>
                </Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-3">
                  {plans.map((plan) => {
                    const selectedProduct = plan[selectedInterval];
                    const isCurrentPlan = plan.planType === currentPlanType;
                    const ctaLabel = hasPaidPlan
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
                                {plan.description}
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
                            <div className="text-3xl font-semibold tracking-tight">
                              {formatPlanPrice(
                                selectedProduct,
                                selectedInterval
                              )}
                            </div>
                          </div>
                        </CardHeader>
                        <CardPanel className="space-y-4">
                          <Separator />
                          <div className="space-y-3">
                            {plan.includesLabel ? (
                              <div className="text-muted-foreground text-sm font-medium">
                                {plan.includesLabel}
                              </div>
                            ) : null}
                            {plan.features.map((feature) => (
                              <div className="text-sm" key={feature.key}>
                                {feature.label}
                              </div>
                            ))}
                          </div>
                        </CardPanel>
                        <CardFooter>
                          <Button
                            className="w-full"
                            disabled={
                              loadingPlanType !== null ||
                              (!hasPaidPlan &&
                                ((!isCurrentPlan && plan.planType === "free") ||
                                  isCurrentPlan ||
                                  (plan.planType !== "free" &&
                                    !selectedProduct)))
                            }
                            onClick={async () => {
                              if (hasPaidPlan) {
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
                                productId: selectedProduct.productId,
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
                <div className="text-muted-foreground rounded-4xl border px-4 py-3 text-sm">
                  You are on the {PLAN_COPY[currentPlanType].name} plan. Use the
                  billing portal to change plans, update payment details, or
                  cancel.
                </div>
              ) : null}
            </CardPanel>
          </Card>
        </div>
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Card, CardFooter, CardHeader, CardPanel } from "@feeblo/ui/card";
import { Skeleton } from "@feeblo/ui/skeleton";
import { useState } from "react";

import { usePlanCatalog } from "~/hooks/use-plan-catalog";

import { startBillingCheckout, startBillingPortal } from "../lib/checkout";
import {
  type BillingInterval,
  buildPlanCards,
  type PlanCard as PlanCardData,
  type PlanType,
} from "../lib/plans";
import { BillingIntervalTabs } from "./billing-interval-tabs";
import { PlanCard } from "./plan-card";
import { PlanComparison } from "./plan-comparison";

export function PlansSection({
  currentPlanType,
  organizationId,
}: {
  readonly currentPlanType: PlanType;
  readonly organizationId: string;
}) {
  const catalog = usePlanCatalog();
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [loadingPlanType, setLoadingPlanType] = useState<PlanType | null>(null);
  const hasPaidPlan = currentPlanType !== "free";

  const handlePlanAction = async (plan: PlanCardData) => {
    if (hasPaidPlan) {
      setLoadingPlanType(plan.planType);

      const didStart = await startBillingPortal({ organizationId });

      if (!didStart) {
        setLoadingPlanType(null);
      }

      return;
    }

    const price = interval === "year" ? plan.year : plan.month;

    if (!price) {
      return;
    }

    setLoadingPlanType(plan.planType);

    const didStart = await startBillingCheckout({
      organizationId,
      productId: price.productId,
    });

    if (!didStart) {
      setLoadingPlanType(null);
    }
  };

  if (catalog.data === undefined) {
    return (
      <section className="scroll-mt-24 space-y-4" id="plans">
        <PlansHeader interval={interval} onIntervalChange={setInterval} />
        {catalog.isError ? (
          <PlansUnavailable
            onRetry={() => {
              void catalog.refetch();
            }}
          />
        ) : (
          <PlanCardsSkeleton />
        )}
      </section>
    );
  }

  const { plans } = buildPlanCards(catalog.data, currentPlanType);

  return (
    <section className="scroll-mt-24 space-y-4" id="plans">
      <PlansHeader interval={interval} onIntervalChange={setInterval} />
      <div className="grid gap-4 xl:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            currentPlanType={currentPlanType}
            hasPaidPlan={hasPaidPlan}
            interval={interval}
            isBusy={loadingPlanType !== null}
            isLoading={loadingPlanType === plan.planType}
            key={plan.planType}
            onAction={() => {
              void handlePlanAction(plan);
            }}
            plan={plan}
          />
        ))}
      </div>
      <PlanComparison
        catalog={catalog.data}
        currentPlanType={currentPlanType}
      />
    </section>
  );
}

function PlansHeader({
  interval,
  onIntervalChange,
}: {
  readonly interval: BillingInterval;
  readonly onIntervalChange: (interval: BillingInterval) => void;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h2 className="font-heading text-lg font-semibold tracking-tight">
          Plans
        </h2>
        <p className="text-muted-foreground text-sm">
          Compare what each plan includes and choose the one that fits this
          workspace.
        </p>
      </div>
      <BillingIntervalTabs onValueChange={onIntervalChange} value={interval} />
    </div>
  );
}

function PlansUnavailable({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <Alert variant="error">
      <AlertTitle>Plans are unavailable right now</AlertTitle>
      <AlertDescription>
        The pricing catalog could not be loaded. Try again in a moment.
      </AlertDescription>
      <Button
        className="mt-3"
        onClick={onRetry}
        size="sm"
        type="button"
        variant="outline"
      >
        Retry
      </Button>
    </Alert>
  );
}

function PlanCardsSkeleton() {
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {["free", "starter", "professional"].map((planType) => (
        <Card key={planType} size="sm">
          <CardHeader>
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-40" />
          </CardHeader>
          <CardPanel className="space-y-5">
            <Skeleton className="h-8 w-28" />
            <Skeleton className="h-px w-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-11/12" />
              <Skeleton className="h-4 w-10/12" />
            </div>
          </CardPanel>
          <CardFooter>
            <Skeleton className="h-8 w-full" />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}

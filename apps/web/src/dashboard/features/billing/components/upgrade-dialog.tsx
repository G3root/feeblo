import type { TPlanPricing } from "@feeblo/domain/pricing/schema";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import { Card, CardFooter, CardHeader, CardPanel } from "@feeblo/ui/card";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { Skeleton } from "@feeblo/ui/skeleton";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";
import { useState } from "react";

import { BillingIntervalTabs } from "~/features/billing/components/billing-interval-tabs";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlan } from "~/hooks/use-plan";
import { usePlanCatalog } from "~/hooks/use-plan-catalog";

import { useUpgradePlanDialogContext } from "../dialog-stores";
import { startBillingCheckout, startBillingPortal } from "../lib/checkout";
import {
  type BillingInterval,
  buildPlanCards,
  type PlanCard as PlanCardData,
  type PlanType,
} from "../lib/plans";
import { PlanCard } from "./plan-card";
import { PlanComparison } from "./plan-comparison";

/**
 * The plan picker, as one scrolling column: pricing cards, then the full
 * comparison, then the caveats that decide what a viewer can do.
 *
 * It is opened from the dashboard's upgrade prompts and from billing settings,
 * so it carries no route state and reads the workspace plan itself. A paid
 * workspace changes plans through the portal; a free one checks out here.
 */
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

  const catalog = usePlanCatalog();
  const workspacePlan = usePlan();
  const currentPlanType = workspacePlan.data?.plan ?? "free";

  if (catalog.isError) {
    return (
      <UpgradePlanDialogError
        onRetry={() => {
          void catalog.refetch();
        }}
      />
    );
  }

  if (catalog.data === undefined || workspacePlan.isLoading) {
    return <UpgradePlanDialogSkeleton />;
  }

  return (
    <UpgradePlanDialogContent
      catalog={catalog.data}
      currentPlanType={currentPlanType}
      organizationId={organizationId}
    />
  );
}

function UpgradePlanDialogContent({
  catalog,
  currentPlanType,
  organizationId,
}: {
  readonly catalog: readonly TPlanPricing[];
  readonly currentPlanType: PlanType;
  readonly organizationId: string;
}) {
  const [interval, setInterval] = useState<BillingInterval>("year");
  const [loadingPlanType, setLoadingPlanType] = useState<PlanType | null>(null);

  const { allowed: canManageBilling } = usePolicy(
    hasPermission(organizationId, "billing.update")
  );

  const hasPaidPlan = currentPlanType !== "free";
  const { plans } = buildPlanCards(catalog, currentPlanType);

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

  return (
    <DialogPopup className="max-w-5xl">
      <DialogPanel className="space-y-6 pt-6">
        <DialogHeader className="gap-4 p-0 pr-10">
          <DialogIntro />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-medium">Billing interval</p>
            <BillingIntervalTabs onValueChange={setInterval} value={interval} />
          </div>
        </DialogHeader>

        <div className="grid gap-3 md:grid-cols-3">
          {plans.map((plan) => (
            <PlanCard
              canManageBilling={canManageBilling}
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

        <PlanComparison catalog={catalog} currentPlanType={currentPlanType} />

        <UpgradePlanDialogNotes
          canManageBilling={canManageBilling}
          hasPaidPlan={hasPaidPlan}
        />
      </DialogPanel>
    </DialogPopup>
  );
}

function DialogIntro() {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-primary/15 text-primary flex size-9 shrink-0 items-center justify-center rounded-xl">
        <HugeiconsIcon
          aria-hidden="true"
          className="size-4"
          icon={SparklesIcon}
        />
      </div>
      <div className="min-w-0">
        <DialogTitle>Plans</DialogTitle>
        <DialogDescription className="mt-1">
          Pick the plan that fits this workspace. You can change plans or cancel
          at any time.
        </DialogDescription>
      </div>
    </div>
  );
}

function UpgradePlanDialogNotes({
  canManageBilling,
  hasPaidPlan,
}: {
  readonly canManageBilling: boolean;
  readonly hasPaidPlan: boolean;
}) {
  if (canManageBilling && !hasPaidPlan) {
    return null;
  }

  return (
    <div className="text-muted-foreground space-y-1.5 text-xs">
      {canManageBilling ? null : (
        <p>Only workspace admins can change the subscription.</p>
      )}
      {hasPaidPlan ? (
        <p>To move to Free, cancel your subscription in Manage billing.</p>
      ) : null}
    </div>
  );
}

function UpgradePlanDialogSkeleton() {
  return (
    <DialogPopup className="max-w-5xl">
      <DialogPanel className="space-y-6 pt-6">
        <DialogHeader className="p-0 pr-10">
          <DialogIntro />
        </DialogHeader>
        <div className="grid gap-3 md:grid-cols-3">
          {["free", "starter", "professional"].map((planType) => (
            <Card key={planType} size="sm">
              <CardHeader>
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-4 w-36" />
              </CardHeader>
              <CardPanel className="space-y-4">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-px w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-10/12" />
              </CardPanel>
              <CardFooter>
                <Skeleton className="h-8 w-full" />
              </CardFooter>
            </Card>
          ))}
        </div>
        <Skeleton className="h-64 w-full rounded-2xl" />
      </DialogPanel>
    </DialogPopup>
  );
}

function UpgradePlanDialogError({ onRetry }: { readonly onRetry: () => void }) {
  return (
    <DialogPopup className="max-w-5xl">
      <DialogPanel className="space-y-6 pt-6">
        <DialogHeader className="p-0 pr-10">
          <DialogIntro />
        </DialogHeader>
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
      </DialogPanel>
    </DialogPopup>
  );
}

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
import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import {
  type BillingInterval,
  describePlanAction,
  describePlanPrice,
  type PlanCard as PlanCardData,
  type PlanType,
} from "../lib/plans";

export function PlanCard({
  currentPlanType,
  hasPaidPlan,
  interval,
  isBusy,
  isLoading,
  onAction,
  plan,
}: {
  readonly currentPlanType: PlanType;
  readonly hasPaidPlan: boolean;
  readonly interval: BillingInterval;
  /** True while any card's checkout or portal request is in flight. */
  readonly isBusy: boolean;
  readonly isLoading: boolean;
  readonly onAction: () => void;
  readonly plan: PlanCardData;
}) {
  const action = describePlanAction({
    currentPlanType,
    hasPaidPlan,
    interval,
    plan,
  });

  const isCurrent = plan.planType === currentPlanType;

  return (
    <Card className={isCurrent ? "border-primary/40" : undefined} size="sm">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>{plan.name}</CardTitle>
            <CardDescription>{plan.description}</CardDescription>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            {plan.recommended ? (
              <Badge variant="secondary">Popular</Badge>
            ) : null}
            {isCurrent ? <Badge>Current</Badge> : null}
          </div>
        </div>
      </CardHeader>
      <CardPanel className="space-y-5">
        <PlanPrice interval={interval} plan={plan} />
        <Separator />
        <PlanFeatures plan={plan} />
      </CardPanel>
      <CardFooter>
        <Button
          className="w-full"
          disabled={action.disabled || isBusy}
          loading={isLoading}
          onClick={onAction}
          type="button"
          variant={isCurrent ? "secondary" : "default"}
        >
          {action.label}
        </Button>
      </CardFooter>
    </Card>
  );
}

function PlanPrice({
  interval,
  plan,
}: {
  readonly interval: BillingInterval;
  readonly plan: PlanCardData;
}) {
  const price = describePlanPrice(plan, interval);

  const displayAmount =
    plan.planType === "free" ? "Free" : (price.amount ?? "—");

  return (
    <div>
      <p className="flex items-baseline gap-1.5">
        <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
          {displayAmount}
        </span>
        {price.suffix === null ? null : (
          <span className="text-muted-foreground text-sm">{price.suffix}</span>
        )}
      </p>
      <p className="text-muted-foreground mt-2 text-xs">{price.note}</p>
    </div>
  );
}

function PlanFeatures({ plan }: { readonly plan: PlanCardData }) {
  return (
    <div className="space-y-2.5">
      {plan.includesLabel ? (
        <p className="text-sm font-medium">{plan.includesLabel}</p>
      ) : null}
      <ul className="space-y-2">
        {plan.features.map((feature) => (
          <li className="flex items-start gap-2 text-sm" key={feature.key}>
            <HugeiconsIcon
              aria-hidden="true"
              className="text-primary mt-0.5 size-3.5 shrink-0"
              icon={Tick02Icon}
              strokeWidth={2.2}
            />
            <span className="text-muted-foreground">{feature.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

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

import {
  type BillingInterval,
  describePlanAction,
  describePlanPrice,
  type PlanCard as PlanCardData,
  type PlanType,
} from "../lib/plans";

/**
 * One plan's price and action.
 *
 * Deliberately compact: the dialog it lives in follows the cards with the full
 * comparison table, so repeating a feature list here would state the same
 * allowances twice and push the table out of reach.
 */
export function PlanCard({
  canManageBilling,
  currentPlanType,
  hasPaidPlan,
  interval,
  isBusy,
  isLoading,
  onAction,
  plan,
}: {
  readonly canManageBilling: boolean;
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

  const price = describePlanPrice(plan, interval);
  const isCurrent = plan.planType === currentPlanType;

  const displayAmount =
    plan.planType === "free" ? "Free" : (price.amount ?? "—");

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
      <CardPanel>
        <p className="flex items-baseline gap-1.5">
          <span className="text-3xl leading-none font-semibold tracking-tight tabular-nums">
            {displayAmount}
          </span>
          {price.suffix === null ? null : (
            <span className="text-muted-foreground text-sm">
              {price.suffix}
            </span>
          )}
        </p>
        <p className="text-muted-foreground mt-2 text-xs">{price.note}</p>
      </CardPanel>
      <CardFooter>
        <Button
          className="w-full"
          disabled={!canManageBilling || action.disabled || isBusy}
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

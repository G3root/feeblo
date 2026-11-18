import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { CrownIcon, GiftIcon, StarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon, type IconSvgElement } from "@hugeicons/react";
import { useState } from "react";

import { useUpgradePlanDialogContext } from "../dialog-stores";
import { startBillingPortal } from "../lib/checkout";
import { PLAN_COPY, type PlanType } from "../lib/plans";

const PLAN_ICONS = {
  free: GiftIcon,
  starter: StarIcon,
  professional: CrownIcon,
} as const satisfies Record<PlanType, IconSvgElement>;

/**
 * The workspace's active plan, with the one action that changes it.
 *
 * A paid workspace changes or cancels through the billing portal; both paths
 * are reachable from the plan dialog this card opens, which shows the pricing
 * and the comparison. Neither path invents subscription details the workspace
 * read does not carry (an interval or a renewal date), so the card states the
 * plan and stops there.
 */
export function CurrentPlanCard({
  organizationId,
  plan,
}: {
  readonly organizationId: string;
  readonly plan: PlanType;
}) {
  const [isOpeningPortal, setIsOpeningPortal] = useState(false);
  const upgradePlanStore = useUpgradePlanDialogContext();
  const copy = PLAN_COPY[plan];
  const hasPaidPlan = plan !== "free";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Current plan</CardTitle>
        <CardDescription>The plan this workspace runs on.</CardDescription>
      </CardHeader>
      <CardPanel>
        <div className="flex items-center gap-4">
          <div className="bg-primary/10 text-primary flex size-11 shrink-0 items-center justify-center rounded-xl">
            <HugeiconsIcon
              aria-hidden="true"
              className="size-5"
              icon={PLAN_ICONS[plan]}
            />
          </div>
          <div className="space-y-1">
            <p className="font-heading text-lg leading-none font-semibold">
              {copy.name} plan
            </p>
            <p className="text-muted-foreground text-sm">{copy.description}</p>
          </div>
        </div>
      </CardPanel>
      <CardFooter className="flex-wrap justify-between gap-3 border-t">
        <p className="text-muted-foreground max-w-md text-sm">
          {hasPaidPlan
            ? "Use the billing portal to change plans, update payment details, or cancel."
            : "Upgrade any time to raise the workspace limits and unlock integrations, the public API, and more."}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {hasPaidPlan ? (
            <Button
              loading={isOpeningPortal}
              onClick={async () => {
                setIsOpeningPortal(true);

                const didStart = await startBillingPortal({ organizationId });

                if (!didStart) {
                  setIsOpeningPortal(false);
                }
              }}
              type="button"
            >
              Manage billing
            </Button>
          ) : null}
          <Button
            onClick={() => {
              upgradePlanStore.send({ type: "setOpen", open: true });
            }}
            type="button"
            variant="outline"
          >
            View plans
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

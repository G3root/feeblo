import { PLAN_FEATURE_CATALOG } from "@feeblo/domain/plan-entitlements";
import { Button, buttonVariants } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Checkbox } from "@feeblo/ui/checkbox";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { usePlanLock } from "~/hooks/use-plan-lock";

import { startBillingPortal } from "../lib/checkout";

/**
 * The pre-downgrade path: what the free plan would lock, and the deliberate
 * step before the Polar portal. The portal can still be reached directly, so
 * this is not a gate — the read-only lock is. It exists so the owner sees the
 * consequences before cancelling, which the hosted portal cannot show.
 */
export function DowngradePlanCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const lock = usePlanLock();
  const [acknowledged, setAcknowledged] = useState(false);

  const preview = lock.data?.preview;
  const lockedFeatures =
    preview?.features.filter((feature) => feature.lockedIds.length > 0) ?? [];
  const lockedCount = lockedFeatures.reduce(
    (total, feature) => total + feature.lockedIds.length,
    0
  );
  const nothingLocks = !preview || lockedCount === 0;

  return (
    <Card className="border-border border shadow-none ring-0">
      <CardHeader>
        <CardTitle>Downgrade to Free</CardTitle>
        <CardDescription>
          {nothingLocks
            ? "This workspace fits inside the Free plan. Nothing would become read-only."
            : `${lockedCount} ${lockedCount === 1 ? "resource" : "resources"} would become read-only. They stay readable, exportable, and deletable, and everything comes back on the next paid plan.`}
        </CardDescription>
      </CardHeader>
      <CardPanel className="space-y-4">
        {lockedFeatures.length > 0 ? (
          <ul className="text-muted-foreground space-y-1 text-sm">
            {lockedFeatures.map((feature) => {
              const definition = PLAN_FEATURE_CATALOG[feature.feature];
              const label =
                feature.lockedIds.length === 1
                  ? definition.singularLabel
                  : definition.pluralLabel;
              return (
                <li key={feature.feature}>
                  {feature.lockedIds.length} {label}
                </li>
              );
            })}
          </ul>
        ) : null}
        {nothingLocks ? null : (
          <label className="flex items-start gap-3 text-sm">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={() => setAcknowledged((value) => !value)}
            />
            <span>
              I understand {lockedCount}{" "}
              {lockedCount === 1 ? "resource" : "resources"} will become
              read-only on the Free plan.
            </span>
          </label>
        )}
        <div className="flex flex-wrap gap-2">
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            params={{ organizationId }}
            to="/$organizationId/settings/plan-limits"
          >
            Reduce now
          </Link>
          <Button
            disabled={!nothingLocks && !acknowledged}
            onClick={async () => {
              await startBillingPortal({ organizationId });
            }}
            size="sm"
            type="button"
          >
            Continue to billing portal
          </Button>
        </div>
      </CardPanel>
    </Card>
  );
}

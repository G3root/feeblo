import { PLAN_DISPLAY_NAMES } from "@feeblo/domain/plan-entitlements";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@feeblo/ui/alert";
import { buttonVariants } from "@feeblo/ui/button";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { useOrganizationId } from "../../../hooks/use-organization-id";
import { usePlanCompliance } from "../hooks/use-plan-compliance";

/**
 * The over-plan strip on the pages the gate lets through.
 *
 * It does not repeat the findings — the gate owns those — it keeps the reason
 * visible so nobody mistakes a paused integration or a missing admin for a bug.
 */
export function OverPlanBanner() {
  const organizationId = useOrganizationId();
  const { compliance, isOverPlan } = usePlanCompliance();
  const { allowed: canManageBilling } = usePolicy(
    hasPermission(organizationId, "billing.*")
  );

  if (!(compliance && isOverPlan)) {
    return null;
  }

  const planLabel = PLAN_DISPLAY_NAMES[compliance.plan];

  return (
    <Alert className="rounded-none border-x-0 border-t-0" variant="warning">
      <HugeiconsIcon icon={Alert02Icon} />
      <AlertTitle>This workspace is over its {planLabel} plan</AlertTitle>
      <AlertDescription>
        {canManageBilling
          ? "Some resources need attention before the workspace is back inside its plan."
          : "Ask an owner or admin to resolve the workspace's plan."}
      </AlertDescription>
      {canManageBilling ? (
        <AlertAction>
          <Link
            className={buttonVariants({ size: "xs", variant: "outline" })}
            params={{ organizationId }}
            to="/$organizationId/over-plan"
          >
            Review
          </Link>
        </AlertAction>
      ) : null}
    </Alert>
  );
}

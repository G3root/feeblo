import { PLAN_FEATURE_CATALOG } from "@feeblo/domain/plan-entitlements";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@feeblo/ui/alert";
import { buttonVariants } from "@feeblo/ui/button";
import { Alert02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePlanLock } from "~/hooks/use-plan-lock";

/**
 * The dashboard-wide tell that the plan lock is doing something. Rendered on
 * every page from the shell layout, so a member who never opens billing still
 * learns why a board went read-only. The per-resource remedies live on the
 * plan-limits settings page this links to.
 */
export function PlanLockBanner() {
  const organizationId = useOrganizationId();
  const lock = usePlanLock();

  const state = lock.data?.current;
  if (!state || state.plan !== "free") {
    return null;
  }

  const lockedFeatures = state.features.filter(
    (feature) => feature.lockedIds.length > 0
  );
  const lockedCount = lockedFeatures.reduce(
    (total, feature) => total + feature.lockedIds.length,
    0
  );

  if (lockedCount === 0) {
    return null;
  }

  const summary = lockedFeatures
    .map((feature) => {
      const definition = PLAN_FEATURE_CATALOG[feature.feature];
      const label =
        feature.lockedIds.length === 1
          ? definition.singularLabel
          : definition.pluralLabel;
      return `${feature.lockedIds.length} ${label}`;
    })
    .join(" · ");

  return (
    <div className="px-4 pt-4 lg:px-6">
      <Alert variant="error">
        <HugeiconsIcon icon={Alert02Icon} />
        <AlertTitle>
          Your plan ended — {lockedCount}{" "}
          {lockedCount === 1 ? "resource is" : "resources are"} locked
        </AlertTitle>
        <AlertDescription>
          {summary}. Locked resources stay readable, exportable, and deletable;
          upgrade or choose what to keep.
        </AlertDescription>
        <AlertAction>
          <Link
            className={buttonVariants({ size: "sm", variant: "outline" })}
            params={{ organizationId }}
            to="/$organizationId/settings/plan-limits"
          >
            Review locked resources
          </Link>
        </AlertAction>
      </Alert>
    </div>
  );
}

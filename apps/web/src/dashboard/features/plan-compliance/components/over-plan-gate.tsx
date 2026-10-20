import { Badge } from "@feeblo/ui/badge";
import { Button, buttonVariants } from "@feeblo/ui/button";
import { Spinner } from "@feeblo/ui/spinner";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import {
  hasPermission,
  hasRole,
  usePolicy,
} from "@feeblo/web-shared/use-policy";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useOrganizationId } from "../../../hooks/use-organization-id";
import { usePlanCompliance } from "../hooks/use-plan-compliance";
import { useRemediation } from "../hooks/use-remediation";
import {
  buildPlanComplianceView,
  type PlanComplianceRow,
  type PlanComplianceSection,
  type RemediationAction,
} from "../lib/plan-compliance-view";
import { PlanComplianceDegradedSection } from "./plan-compliance-degraded-section";
import { RemediationDialog } from "./remediation-dialog";

/**
 * The full-screen remediation surface for an over-plan workspace.
 *
 * It replaces the workspace's own dashboard: the portal and widget keep
 * serving the workspace's customers, but the dashboard is where the plan is
 * priced, so that is what pauses. Every action is one existing RPC against one
 * row, and nothing is published or deleted without the operator confirming it.
 */
export function OverPlanGate() {
  const organizationId = useOrganizationId();
  const navigate = useNavigate();
  const { compliance, isLoading } = usePlanCompliance();
  const { allowed: canManageBilling, isPending: isPolicyPending } = usePolicy(
    hasPermission(organizationId, "billing.*")
  );
  const { allowed: isOwner } = usePolicy(hasRole(organizationId, "owner"));
  const { pendingAction, run } = useRemediation();
  const { planComplianceCollection } = useDashboardCollections();
  const [dialogAction, setDialogAction] = useState<RemediationAction | null>(
    null
  );
  const hasTrackedView = useRef(false);
  const wasOverPlan = useRef(false);

  // An upgrade happens in another tab (or on Polar's checkout page) and the
  // webhook lands behind this one. Re-reading on mount and on focus is what
  // lets a resolved workspace leave the gate without a hard reload.
  useEffect(() => {
    void planComplianceCollection.utils.refetch();

    const refetch = () => {
      void planComplianceCollection.utils.refetch();
    };
    window.addEventListener("focus", refetch);

    return () => window.removeEventListener("focus", refetch);
  }, [planComplianceCollection]);

  useEffect(() => {
    if (!compliance || hasTrackedView.current) {
      return;
    }

    hasTrackedView.current = true;
    trackEvent("over_plan_gate_viewed", {
      plan: compliance.plan,
      violation_count: compliance.violations.length,
    });
  }, [compliance]);

  useEffect(() => {
    if (compliance && compliance.violations.length > 0) {
      wasOverPlan.current = true;
    }
  }, [compliance]);

  useEffect(() => {
    if (!compliance || compliance.violations.length > 0) {
      return;
    }

    // The last action (or an upgrade in another tab) resolved the workspace.
    // A direct visit to /over-plan by an already-compliant workspace is not a
    // completion, so the event waits until this mount has seen a finding.
    if (wasOverPlan.current) {
      trackEvent("over_plan_remediation_completed", { plan: compliance.plan });
    }
    void navigate({
      to: "/$organizationId",
      params: { organizationId },
      replace: true,
    });
  }, [compliance, navigate, organizationId]);

  if (isLoading || isPolicyPending || !compliance) {
    return <PlanComplianceGateLoading />;
  }

  const view = buildPlanComplianceView(compliance);

  return (
    <main className="bg-background flex min-h-dvh flex-col">
      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
        <header className="flex flex-col gap-3">
          <Badge className="self-start" size="lg" variant="warning">
            Over plan
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            This workspace is over its {view.planLabel} plan
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">
            These resources are left over from a plan that no longer covers
            them. Fix the items below, or change plan to keep using them. Your
            public board and widget keep working either way.
          </p>
        </header>

        {compliance.violations.length === 0 ? null : canManageBilling ? (
          <div className="flex flex-col gap-4">
            {view.sections.map((section) => (
              <PlanComplianceSectionCard
                isOwner={isOwner}
                key={section.key}
                onAction={setDialogAction}
                pending={pendingAction !== null}
                section={section}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border p-4">
            <h2 className="text-sm font-medium">
              An owner or admin has to resolve this
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              The workspace's dashboard is paused until someone who can manage
              the plan removes the extra resources or changes it. You can still
              manage your own account.
            </p>
          </div>
        )}

        <PlanComplianceDegradedSection degraded={compliance.degraded} />

        <footer className="flex flex-wrap items-center gap-3 border-t pt-6">
          {canManageBilling ? (
            <Link
              className={buttonVariants()}
              params={{ organizationId }}
              to="/$organizationId/settings/billing"
            >
              Change plan
            </Link>
          ) : null}
          <Link
            className={buttonVariants({ variant: "ghost" })}
            params={{ organizationId }}
            to="/$organizationId/settings/profile"
          >
            Account settings
          </Link>
        </footer>
      </div>

      <RemediationDialog
        action={dialogAction}
        onConfirm={(action) => {
          setDialogAction(null);
          void run(action);
        }}
        onOpenChange={(open) => {
          if (!open) {
            setDialogAction(null);
          }
        }}
        pending={pendingAction !== null}
      />
    </main>
  );
}

function PlanComplianceSectionCard({
  isOwner,
  onAction,
  pending,
  section,
}: {
  readonly isOwner: boolean;
  readonly onAction: (action: RemediationAction) => void;
  readonly pending: boolean;
  readonly section: PlanComplianceSection;
}) {
  return (
    <section className="bg-card rounded-xl border">
      <header className="flex flex-col gap-1 border-b px-4 py-3">
        <h2 className="text-sm font-medium">{section.title}</h2>
        <p className="text-muted-foreground text-sm">{section.summary}</p>
        {section.truncated ? (
          <p className="text-muted-foreground text-xs">
            Showing the first {section.rows.length} rows. Fix these, then reload
            for the rest.
          </p>
        ) : null}
      </header>
      <ul className="divide-y">
        {section.rows.map((row) => (
          <PlanComplianceRowItem
            isOwner={isOwner}
            key={row.key}
            onAction={onAction}
            pending={pending}
            row={row}
          />
        ))}
      </ul>
    </section>
  );
}

function PlanComplianceRowItem({
  isOwner,
  onAction,
  pending,
  row,
}: {
  readonly isOwner: boolean;
  readonly onAction: (action: RemediationAction) => void;
  readonly pending: boolean;
  readonly row: PlanComplianceRow;
}) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{row.label}</span>
          {row.badges.map((badge) => (
            <Badge key={badge} size="sm" variant="outline">
              {badge}
            </Badge>
          ))}
        </div>
        {row.detail ? (
          <p className="text-muted-foreground text-xs">{row.detail}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {row.actions.map((action) => {
          const requiresOwner = action.ownerOnly && !isOwner;

          return (
            <Button
              disabled={pending || requiresOwner}
              key={`${action.type}:${action.resourceId}`}
              onClick={() => onAction(action)}
              size="xs"
              title={
                requiresOwner
                  ? "An owner must do this"
                  : action.destructive
                    ? "This cannot be undone"
                    : undefined
              }
              type="button"
              variant={action.destructive ? "destructive-outline" : "outline"}
            >
              {action.rowLabel}
            </Button>
          );
        })}
      </div>
    </li>
  );
}

function PlanComplianceGateLoading() {
  return (
    <main className="bg-background flex min-h-dvh items-center justify-center">
      <div className="text-muted-foreground flex items-center gap-3 text-sm">
        <Spinner />
        Checking the workspace's plan…
      </div>
    </main>
  );
}

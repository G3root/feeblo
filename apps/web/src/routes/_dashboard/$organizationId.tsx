import type { TWorkspacePlanCompliance } from "@feeblo/domain/plan-compliance/schema";
import { useAuth } from "@feeblo/web-shared/auth-context";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";

import { groupPostHogOrganization } from "~/components/posthog-provider";
import { AuthGate } from "~/features/auth/components/organization-auth-gate";
import { isOverPlanPathAllowed } from "~/features/plan-compliance/lib/over-plan-routes";
import { planComplianceCollectionFor } from "~/lib/collections";

export const Route = createFileRoute("/_dashboard/$organizationId")({
  beforeLoad: async ({ location, params }) => {
    let compliance: TWorkspacePlanCompliance | undefined;

    try {
      // Both the collection lookup and the preload can fail before the route
      // renders; the gate must not brick the dashboard when either does.
      const collection = planComplianceCollectionFor(params.organizationId);
      await collection.preload();
      compliance = collection.get(params.organizationId);
    } catch {
      // The gate is a product contract, not a security boundary. A snapshot
      // that cannot be read lets the page render; the server policies still
      // refuse every write that would deepen an over-plan state.
      return;
    }

    if (
      compliance === undefined ||
      compliance.violations.length === 0 ||
      isOverPlanPathAllowed(
        location.pathname,
        params.organizationId,
        compliance
      )
    ) {
      return;
    }

    throw redirect({
      to: "/$organizationId/over-plan",
      params: { organizationId: params.organizationId },
    });
  },
  component: OrganizationLayoutRoute,
});

// ---------------------------------------------------------------------------
// Dashboard auth gate.
//
// The root route's `beforeLoad` guard (`~/lib/auth-redirects`) resolves the
// session and redirects anonymous visitors before any route renders. This
// component gate is the second line of defence: it covers a session that
// expires while the SPA is already open, after the guard has already run. It
// lives on the organization route rather than `__root` because Feeblo's
// sign-in, sign-up, verification, and registration routes share the same root
// and must render without an authenticated session.
// ---------------------------------------------------------------------------

function OrganizationLayoutRoute() {
  return (
    <AuthGate>
      <PostHogOrganizationGroup />
      <Outlet />
    </AuthGate>
  );
}

function PostHogOrganizationGroup() {
  const auth = useAuth();
  const { organizationId } = Route.useParams();
  const canGroup = auth.status === "authenticated" && auth.data !== null;

  useEffect(() => {
    if (!canGroup) {
      return;
    }

    groupPostHogOrganization(organizationId);
  }, [canGroup, organizationId]);

  return null;
}

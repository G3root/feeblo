import { useAuth } from "@feeblo/web-shared/auth-context";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

import { AuthGate } from "~/features/auth/components/organization-auth-gate";

import { groupPostHogOrganization } from "../components/posthog-provider";

export const Route = createFileRoute("/$organizationId")({
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

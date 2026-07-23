import { useAuth } from "@feeblo/web-shared/auth-context";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";
import { groupPostHogOrganization } from "../components/posthog-provider";

export const Route = createFileRoute("/$organizationId")({
  component: OrganizationLayoutRoute,
});

// ---------------------------------------------------------------------------
// Dashboard auth gate.
//
// Astro middleware authenticates the initial document request before any app
// HTML is served. This client gate is the second line of defence: it covers the
// atom's first reconciliation and a session that expires while the SPA is
// already open. It lives on the organization route rather than `__root` because
// Feeblo's sign-in, sign-up, verification, and registration routes share the
// same root and must render without an authenticated session.
// ---------------------------------------------------------------------------

function Loading({ label }: { readonly label: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center text-muted-foreground text-sm">
      {label}
    </div>
  );
}

function AuthGate({ children }: { readonly children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    if (auth.status !== "unauthenticated") {
      return;
    }

    // A full navigation lets middleware verify the next document and preserves
    // this deep link for the post-login redirect.
    const redirectTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const signInUrl = new URL("/sign-in", window.location.origin);
    signInUrl.searchParams.set("redirectTo", redirectTo);
    window.location.assign(signInUrl.toString());
  }, [auth.status]);

  if (auth.status === "authenticated") {
    return <>{children}</>;
  }

  return (
    <Loading
      label={
        auth.status === "unauthenticated"
          ? "Redirecting to sign in…"
          : "Loading…"
      }
    />
  );
}

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

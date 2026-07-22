/** biome-ignore-all lint/complexity/noVoid: Navigation is intentionally fire-and-forget from the effect. */
import { useNavigate, useParams, useRouterState } from "@tanstack/react-router";
import { type ReactNode, useEffect } from "react";

// ---------------------------------------------------------------------------
// Organization-id URL canonicalization for Feeblo's dashboard.
//
// Dashboard routes live under `$organizationId`, so route data and every RPC
// are scoped by the id in the URL. This gate retargets a stale route to the
// active organization without discarding the current path or query string.
//
// A genuinely unmatched path must remain unmatched. Rewriting a router-level
// not-found match would turn a bad URL into an apparently valid dashboard
// route, so canonicalization is skipped for global not-found matches.
// ---------------------------------------------------------------------------

export interface OrganizationIdGateProps {
  readonly activeOrganizationId: string;
  readonly children: ReactNode;
}

export function OrganizationIdGate({
  activeOrganizationId,
  children,
}: OrganizationIdGateProps) {
  const params = useParams({ strict: false }) as { organizationId?: string };
  const navigate = useNavigate();
  const isNotFound = useRouterState({
    select: (state) => state.matches.some((match) => match.globalNotFound),
  });
  const needsCanonicalization =
    params.organizationId !== activeOrganizationId && !isNotFound;

  useEffect(() => {
    if (!needsCanonicalization) {
      return;
    }

    // Retarget the current route, preserving deep-link path and search state;
    // only the organization scope changes.
    void navigate({
      to: ".",
      params: (previous: Record<string, string>) => ({
        ...previous,
        organizationId: activeOrganizationId,
      }),
      search: true,
      replace: true,
    });
  }, [activeOrganizationId, navigate, needsCanonicalization]);

  // Render through during replacement because the destination is the same
  // route shape. Withholding children here would introduce an avoidable flash.
  return <>{children}</>;
}

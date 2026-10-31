import { roleGrants } from "@feeblo/permissions";
import { Button } from "@feeblo/ui/button";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useResolvedAuth } from "@feeblo/web-shared/auth-context";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

/**
 * The workspace step of an MCP authorization.
 *
 * The provider redirects here before consent when the member's session has no
 * usable active workspace (or several). An OAuth grant is for one workspace,
 * so choosing it is what makes `consentReferenceId` answerable; the choice is
 * the same `activeOrganizationId` the dashboard uses.
 */
export const Route = createFileRoute("/oauth/select-workspace")({
  component: SelectWorkspacePage,
});

type Workspace = { readonly id: string; readonly name: string };

function SelectWorkspacePage() {
  const auth = useResolvedAuth();
  const [workspaces, setWorkspaces] = useState<readonly Workspace[] | null>(
    null
  );
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isAuthenticated = auth.status === "authenticated";

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await authClient.organization.list();
      if (cancelled) {
        return;
      }
      if (result.error) {
        setError(
          result.error.message ?? "Your workspaces could not be loaded."
        );
        return;
      }
      setWorkspaces(result.data ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  const choose = async (organizationId: string) => {
    setPendingId(organizationId);
    setError(null);

    const active = await authClient.organization.setActive({
      organizationId,
    });
    if (active.error) {
      setError(active.error.message ?? "That workspace could not be selected.");
      setPendingId(null);
      return;
    }

    const continued = await authClient.oauth2.continue({ postLogin: true });
    if (continued.error) {
      setError(
        continued.error.message ?? "The authorization could not be continued."
      );
      setPendingId(null);
      return;
    }
    if (continued.data?.url) {
      window.location.assign(continued.data.url);
    }
  };

  // An OAuth grant is a workspace-wide credential, so only the roles that may
  // create one may authorize. The server enforces the same rule; filtering
  // here keeps the page from offering a choice that would be refused.
  const authorizedOrganizationIds =
    auth.status === "authenticated" && auth.data !== null
      ? new Set(
          auth.data.memberships
            .filter((membership) =>
              roleGrants(membership.role, "apiKeys.manage")
            )
            .map((membership) => membership.organizationId)
        )
      : new Set<string>();
  const visibleWorkspaces =
    workspaces?.filter((workspace) =>
      authorizedOrganizationIds.has(workspace.id)
    ) ?? null;

  if (!isAuthenticated) {
    return (
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Choose a workspace</h1>
        <p className="text-muted-foreground text-sm">
          Your session has expired. Close this window and reconnect the
          application to start again.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Choose a workspace</h1>
        <p className="text-muted-foreground text-sm">
          The application will act only in the workspace you choose.
        </p>
      </div>

      {error === null ? null : (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      {visibleWorkspaces === null && error === null ? (
        <p className="text-muted-foreground text-sm">Loading…</p>
      ) : null}

      {visibleWorkspaces?.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          You need an owner or admin role in a workspace to authorize an
          application.
        </p>
      ) : null}

      <ul className="space-y-2">
        {visibleWorkspaces?.map((workspace) => (
          <li key={workspace.id}>
            <Button
              className="w-full justify-start"
              disabled={pendingId !== null}
              onClick={() => void choose(workspace.id)}
              variant="outline"
            >
              {pendingId === workspace.id ? "Opening…" : workspace.name}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

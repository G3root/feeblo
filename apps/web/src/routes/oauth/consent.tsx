import {
  PUBLIC_API_DEFAULT_SCOPES,
  PUBLIC_API_SCOPES,
  type PublicApiScope,
} from "@feeblo/domain-contracts/public-api-scope";
import { Button } from "@feeblo/ui/button";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useResolvedAuth } from "@feeblo/web-shared/auth-context";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";

/**
 * The consent step of an MCP authorization.
 *
 * The provider sends the signed authorization query as the page's search
 * string (`scope`, `client_id`, …); `oauthProviderClient` forwards it as
 * `oauth_query` on the consent call, so the server verifies the signature and
 * this page only chooses *what* to grant.
 *
 * Every requested scope is shown and the member chooses. Identity scopes start
 * selected (the client needs them to sign the member in) and workspace scopes
 * start at the read-only default, so a client is never handed write access by a
 * member who clicked "Allow" without reading the list.
 */
export const Route = createFileRoute("/oauth/consent")({
  validateSearch: (search) =>
    z
      .object({
        client_id: z.string().optional(),
        scope: z.string().optional(),
      })
      .passthrough()
      .parse(search),
  component: ConsentPage,
});

const OIDC_SCOPES = new Set(["openid", "profile", "email", "offline_access"]);

/** The read-only set a new grant starts with. */
const DEFAULT_SCOPES: ReadonlySet<string> = new Set(PUBLIC_API_DEFAULT_SCOPES);

const API_SCOPES: ReadonlySet<string> = new Set(PUBLIC_API_SCOPES);

const isPublicApiScope = (scope: string): scope is PublicApiScope =>
  API_SCOPES.has(scope);

/** `posts.create` → `Create posts`. */
const describeScope = (scope: PublicApiScope): string => {
  const [resource, action = ""] = scope.split(".");
  const subject = resource.replaceAll("_", " ");
  const sentence = `${action} ${subject}`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
};

/** What an OIDC scope lets the client see or do. */
const describeIdentityScope = (scope: string): string => {
  switch (scope) {
    case "openid":
      return "Confirm your identity";
    case "profile":
      return "Read your name and profile picture";
    case "email":
      return "Read your email address";
    case "offline_access":
      return "Stay connected after this session ends";
    default:
      return scope;
  }
};

function ConsentPage() {
  const search = Route.useSearch();
  const auth = useResolvedAuth();
  // A client that sends no `scope` is asking for the server's whole advertised
  // set — the provider's default is `opts.scopes`, which includes every write.
  // Rendering that set (rather than nothing) is what lets the member narrow it.
  const requested =
    search.scope === undefined || search.scope.length === 0
      ? [...OIDC_SCOPES, ...PUBLIC_API_SCOPES]
      : search.scope.split(" ").filter(Boolean);
  const requestedApiScopes = requested.filter(isPublicApiScope);
  const requestedIdentityScopes = requested.filter((scope) =>
    OIDC_SCOPES.has(scope)
  );

  // One selection over both vocabularies: identity scopes start accepted
  // because the client needs them to sign the member in, and workspace scopes
  // start at the read-only set.
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () =>
      new Set([
        ...requestedIdentityScopes,
        ...requestedApiScopes.filter((scope) => DEFAULT_SCOPES.has(scope)),
      ])
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);

  const activeOrganizationId =
    auth.status === "authenticated" && auth.data !== null
      ? auth.data.session.activeOrganizationId
      : null;

  // The session carries organization ids only, so the name is a second read.
  // The workspace is what the consent binds to, so naming it is the one piece
  // of context that makes the scopes below meaningful.
  useEffect(() => {
    if (activeOrganizationId === null) {
      return;
    }
    let cancelled = false;
    void (async () => {
      const result = await authClient.organization.list();
      if (cancelled || result.error) {
        return;
      }
      const active = result.data?.find(
        (organization) => organization.id === activeOrganizationId
      );
      if (active) {
        setWorkspaceName(active.name);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeOrganizationId]);

  const toggle = (scope: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(scope);
      } else {
        next.delete(scope);
      }
      return next;
    });
  };

  const respond = async (accept: boolean) => {
    setPending(true);
    setError(null);

    // Only an acceptance names the scopes; a refusal grants nothing. An empty
    // `scope` would be read as "the originally requested set", so an acceptance
    // with nothing selected has to be refused here rather than sent.
    const accepted = accept
      ? requested.filter((scope) => selected.has(scope))
      : null;
    if (accepted !== null && accepted.length === 0) {
      setError("Choose at least one permission, or cancel the request.");
      setPending(false);
      return;
    }
    const result = await authClient.oauth2.consent(
      accepted === null ? { accept } : { accept, scope: accepted.join(" ") }
    );

    if (result.error) {
      setError(result.error.message ?? "The request could not be completed.");
      setPending(false);
      return;
    }
    if (result.data?.url) {
      window.location.assign(result.data.url);
    }
  };

  if (auth.status !== "authenticated") {
    return (
      <div className="space-y-2">
        <h1 className="text-lg font-semibold">Authorize application</h1>
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
        <h1 className="text-lg font-semibold">
          Authorize {search.client_id ?? "this application"}
        </h1>
        <p className="text-muted-foreground text-sm">
          It is asking for access to{" "}
          <strong>{workspaceName ?? "the workspace you selected"}</strong>{" "}
          through the Feeblo API.
        </p>
      </div>

      {error === null ? null : (
        <p className="text-destructive text-sm" role="alert">
          {error}
        </p>
      )}

      {requestedIdentityScopes.length === 0 ? null : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Account access</legend>
          {requestedIdentityScopes.map((scope) => (
            <label className="flex items-start gap-2 text-sm" key={scope}>
              <input
                checked={selected.has(scope)}
                className="mt-1"
                disabled={pending}
                onChange={(event) => toggle(scope, event.target.checked)}
                type="checkbox"
              />
              <span>
                {describeIdentityScope(scope)}
                <span className="text-muted-foreground block text-xs">
                  {scope}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      {requestedApiScopes.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          This application is not asking to read or change anything in the
          workspace.
        </p>
      ) : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Workspace access</legend>
          {requestedApiScopes.map((scope) => (
            <label className="flex items-start gap-2 text-sm" key={scope}>
              <input
                checked={selected.has(scope)}
                className="mt-1"
                disabled={pending}
                onChange={(event) => toggle(scope, event.target.checked)}
                type="checkbox"
              />
              <span>
                {describeScope(scope)}
                <span className="text-muted-foreground block text-xs">
                  {scope}
                </span>
              </span>
            </label>
          ))}
        </fieldset>
      )}

      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={pending}
          onClick={() => void respond(true)}
        >
          Allow
        </Button>
        <Button
          className="flex-1"
          disabled={pending}
          onClick={() => void respond(false)}
          variant="outline"
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

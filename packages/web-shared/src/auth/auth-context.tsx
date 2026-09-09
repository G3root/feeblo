import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { AuthClientSession } from "@feeblo/auth/client";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import * as Option from "effect/Option";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import type React from "react";
import { createContext, useContext, useMemo, useState } from "react";

import { authAtomRegistry, meAtom } from "./atoms";
import { readAuthHintFromCookie } from "./hint-cookie";

// ---------------------------------------------------------------------------
// Shared auth seam for Feeblo's dashboard and public-board apps.
//
// The authoritative state comes from `meAtom`, which calls Better Auth's
// custom session endpoint. Auth is resolved entirely on the client: the
// session starts in a loading state on every full page load and reconciles
// once the atom's request finishes.
//
// While that request is in flight, the display-only hint cookie (written by
// the atom itself after previous confirmed resolutions) paints the last known
// identity immediately. Like the atom's response it is never authorization:
// it contains no session token or membership roles, and the resolved response
// always replaces it.
// ---------------------------------------------------------------------------

export type AuthUser = Pick<AuthClientSession["user"], "email" | "name"> & {
  readonly image: string | null;
};

export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | {
      status: "authenticated";
      /** Null only while a display-only hint is awaiting reconciliation. */
      data: AuthClientSession | null;
      user: AuthUser;
    };

const loadingAuthState: AuthState = { status: "loading" };

const AuthContext = createContext<AuthState>(loadingAuthState);

export const useAuth = () => useContext(AuthContext);

/**
 * Authoritative session state from the atom.
 *
 * Hosts that need to react to a *confirmed* resolution (analytics identify,
 * redirects, …) subscribe to this hook directly instead of receiving data
 * back through a parent callback in an effect.
 */
const resolveAuthState = (
  session: Result.AsyncResult<AuthClientSession | null, unknown>
): AuthState =>
  Result.builder(session)
    .onInitial((): AuthState => ({ status: "loading" }))
    // A failed revalidation is not evidence that the user signed out. Keep the
    // last authoritative result when available; otherwise remain loading so
    // consumers can wait for a confirmed resolution.
    .onFailure((_, { previousSuccess }): AuthState =>
      Option.match(previousSuccess, {
        onNone: (): AuthState => ({ status: "loading" }),
        onSome: ({ value }) => confirmedState(value),
      })
    )
    .onSuccess((value) => confirmedState(value))
    .exhaustive();

export const useResolvedAuth = (): AuthState =>
  useAtomValue(meAtom, resolveAuthState);

const sessionState = (session: AuthClientSession): AuthState => ({
  status: "authenticated",
  data: session,
  user: {
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
  },
});

const confirmedState = (session: AuthClientSession | null): AuthState =>
  session === null ? { status: "unauthenticated" } : sessionState(session);

const hintState = (hint: AuthUser | null): AuthState | null =>
  hint === null ? null : { status: "authenticated", data: null, user: hint };

function AuthProviderClient({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const resolved = useResolvedAuth();
  // Read once per mount: the cookie only changes through the atom itself, so
  // a re-render can never observe a fresher hint than the in-flight request.
  const [initialHint] = useState(() => readAuthHintFromCookie());

  const state = useMemo<AuthState>(
    () =>
      resolved.status === "loading"
        ? (hintState(initialHint) ?? resolved)
        : resolved,
    [initialHint, resolved]
  );

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function AuthProvider({
  children,
  registry = authAtomRegistry,
}: {
  readonly children: React.ReactNode;
  /** Test seam: defaults to the shared app-wide registry. */
  readonly registry?: AtomRegistry.AtomRegistry;
}) {
  if (!hasWindow()) {
    return (
      <AuthContext.Provider value={loadingAuthState}>
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <RegistryContext.Provider value={registry}>
      <AuthProviderClient>{children}</AuthProviderClient>
    </RegistryContext.Provider>
  );
}

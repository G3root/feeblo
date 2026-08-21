import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { AuthClientSession } from "@feeblo/auth/client";
import { hasWindow } from "@feeblo/utils/runtime-kind";
import * as Option from "effect/Option";
import * as Result from "effect/unstable/reactivity/AsyncResult";
import type React from "react";
import { createContext, useContext } from "react";

import { authAtomRegistry, meAtom } from "./atoms";

// ---------------------------------------------------------------------------
// Shared auth seam for Feeblo's dashboard and public-board apps.
//
// The authoritative state comes from `meAtom`, which calls Better Auth's
// custom session endpoint. Auth is resolved entirely on the client: the
// session starts in a loading state on every full page load and reconciles
// once the atom's request finishes.
// ---------------------------------------------------------------------------

export type AuthUser = Pick<AuthClientSession["user"], "email" | "name"> & {
  readonly image: string | null;
};

export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | {
      status: "authenticated";
      data: AuthClientSession;
      user: AuthUser;
    };

const AuthContext = createContext<AuthState>({ status: "loading" });

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

function AuthProviderClient({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  const state = useResolvedAuth();

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function AuthProvider({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  if (!hasWindow()) {
    return (
      <AuthContext.Provider value={{ status: "loading" }}>
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <RegistryContext.Provider value={authAtomRegistry}>
      <AuthProviderClient>{children}</AuthProviderClient>
    </RegistryContext.Provider>
  );
}

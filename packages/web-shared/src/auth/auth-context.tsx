import { hasWindow } from "@feeblo/utils/runtime-kind";
import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { AuthClientSession } from "@feeblo/auth/client";
import * as Option from "effect/Option";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type React from "react";
import { createContext, useContext, useMemo } from "react";

import type { AuthHint } from "../utils/auth-hint";
import { authAtomRegistry, meAtom } from "./atoms";

// ---------------------------------------------------------------------------
// Shared auth seam for Feeblo's dashboard and public-board apps.
//
// The authoritative state comes from `meAtom`, which calls Better Auth's
// custom session endpoint. While that request is in flight, the server-verified
// initial hint can paint known display identity immediately. The hint is never
// authorization: it contains no session token or membership roles, and the
// atom's resolved response always replaces it.
//
// Astro middleware already resolves the session for document requests. It
// passes the corresponding hint as a serialized island prop, allowing the
// client-only React root to paint consistently before the atom finishes.
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

const AuthContext = createContext<AuthState>({ status: "loading" });

export const useAuth = () => useContext(AuthContext);

/**
 * Authoritative session state from the atom, ignoring the display-only hint.
 *
 * The provider renders through this state so the hint can paint before the
 * atom resolves; hosts that need to react to a *confirmed* resolution
 * (analytics identify, redirects, …) subscribe to this hook directly instead
 * of receiving data back through a parent callback in an effect.
 */
export const useResolvedAuth = (): AuthState => {
  const session = useAtomValue(meAtom);

  return useMemo<AuthState>(
    () =>
      AsyncResult.match(session, {
        onInitial: () => ({ status: "loading" }),
        // A failed revalidation is not evidence that the user signed out. Keep
        // the last authoritative result when available; otherwise remain in the
        // reconciliation state so an initial server hint can continue to paint.
        onFailure: ({ previousSuccess }) =>
          Option.match(previousSuccess, {
            onNone: () => ({ status: "loading" }),
            onSome: ({ value }) => confirmedState(value),
          }),
        onSuccess: ({ value }) => confirmedState(value),
      }),
    [session]
  );
};

const hintState = (hint: AuthHint | null): AuthState | null =>
  hint === null
    ? null
    : {
        status: "authenticated",
        data: null,
        user: hint.user,
      };

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
  initialHint,
}: {
  readonly children: React.ReactNode;
  readonly initialHint: AuthHint | null;
}) {
  const resolved = useResolvedAuth();

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
  initialHint,
}: {
  readonly children: React.ReactNode;
  readonly initialHint: AuthHint | null;
}) {
  // The server renders the app shell once per request, but consumers still
  // need a stable value identity.
  const serverState = useMemo<AuthState>(
    () => hintState(initialHint) ?? { status: "loading" },
    [initialHint]
  );

  if (!hasWindow()) {
    return (
      <AuthContext.Provider value={serverState}>
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <RegistryContext.Provider value={authAtomRegistry}>
      <AuthProviderClient initialHint={initialHint}>
        {children}
      </AuthProviderClient>
    </RegistryContext.Provider>
  );
}

import { RegistryContext, useAtomValue } from "@effect/atom-react";
import type { AuthClientSession } from "@feeblo/auth/client";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import type React from "react";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import {
  type AuthHint,
  clearAuthHintCookie,
  readAuthHintCookie,
  writeAuthHintCookie,
} from "../utils/auth-hint";
import { authAtomRegistry, meAtom } from "./atoms";

// ---------------------------------------------------------------------------
// Shared auth seam for Feeblo's dashboard and public-board apps.
//
// The authoritative state comes from `meAtom`, which calls Better Auth's
// custom session endpoint. While that request is in flight, a client-readable
// auth-hint cookie can paint known display identity immediately. The hint is
// never authorization: it contains no session token or membership roles, and
// the atom's resolved response always replaces it.
//
// Astro middleware already resolves the session for document requests. It
// passes the corresponding hint as a serialized island prop, allowing the
// client-only React root to paint consistently before the atom finishes.
// ---------------------------------------------------------------------------

export type AuthUser = Pick<
  AuthClientSession["user"],
  "id" | "email" | "name"
> & {
  readonly image: string | null;
};

export type AuthOrganization = AuthClientSession["organizations"][number];

export type AuthState =
  | { status: "loading" }
  | { status: "unauthenticated" }
  | {
      status: "authenticated";
      /** Null only while a display-only hint is awaiting reconciliation. */
      data: AuthClientSession | null;
      user: AuthUser;
      organizations: readonly AuthOrganization[];
    };

export type IdentifyFn = (
  state:
    | Extract<AuthState, { status: "authenticated" }>
    | { status: "unauthenticated" }
) => void;

const AuthContext = createContext<AuthState>({ status: "loading" });

export const useAuth = () => useContext(AuthContext);

const hintState = (hint: AuthHint | null): AuthState | null =>
  hint === null
    ? null
    : {
        status: "authenticated",
        data: null,
        user: hint.user,
        organizations: hint.organizations,
      };

const sessionState = (session: AuthClientSession): AuthState => ({
  status: "authenticated",
  data: session,
  user: {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    image: session.user.image ?? null,
  },
  organizations: session.organizations,
});

function AuthProviderClient({
  children,
  initialHint,
  onIdentify,
}: {
  readonly children: React.ReactNode;
  readonly initialHint: AuthHint | null;
  readonly onIdentify?: IdentifyFn;
}) {
  const session = useAtomValue(meAtom);
  const [hint, setHint] = useState<AuthHint | null>(initialHint);

  useEffect(() => {
    setHint((current) => current ?? readAuthHintCookie());
  }, []);

  const resolved = useMemo<AuthState>(
    () =>
      AsyncResult.match(session, {
        onInitial: () => ({ status: "loading" }),
        onFailure: () => ({ status: "unauthenticated" }),
        onSuccess: ({ value }) =>
          value === null
            ? { status: "unauthenticated" }
            : sessionState(value),
      }),
    [session]
  );

  useEffect(() => {
    if (resolved.status !== "loading") {
      onIdentify?.(resolved);
    }
  }, [onIdentify, resolved]);

  useEffect(() => {
    if (resolved.status === "authenticated") {
      writeAuthHintCookie({
        v: 1,
        user: resolved.user,
        organizations: resolved.organizations,
      });
    } else if (resolved.status === "unauthenticated") {
      clearAuthHintCookie();
    }
  }, [resolved]);

  const state = useMemo<AuthState>(
    () =>
      resolved.status === "loading" ? (hintState(hint) ?? resolved) : resolved,
    [hint, resolved]
  );

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function AuthProvider({
  children,
  initialHint = null,
  onIdentify,
}: {
  readonly children: React.ReactNode;
  readonly initialHint?: AuthHint | null;
  readonly onIdentify?: IdentifyFn;
}) {
  if (typeof window === "undefined") {
    return (
      <AuthContext.Provider
        value={hintState(initialHint) ?? { status: "loading" }}
      >
        {children}
      </AuthContext.Provider>
    );
  }

  return (
    <RegistryContext.Provider value={authAtomRegistry}>
      <AuthProviderClient initialHint={initialHint} onIdentify={onIdentify}>
        {children}
      </AuthProviderClient>
    </RegistryContext.Provider>
  );
}

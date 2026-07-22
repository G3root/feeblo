import type { AuthClientSession } from "@feeblo/auth/client";
import * as Effect from "effect/Effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { authClient } from "../lib/auth-client";

// ---------------------------------------------------------------------------
// Better Auth session atom.
//
// Feeblo's Better Auth custom-session plugin extends the normal session with
// `memberships` and `organizations`. This atom is the single client-side source
// of truth for that complete shape. It replaces the former local React DB
// collection, which duplicated Better Auth state and needed manual syncing.
//
// Better Auth reports a signed-out user as a successful `null` result. Network
// failures are represented by the client response as well, so the Effect itself
// does not need an untyped error channel.
// ---------------------------------------------------------------------------

export const meAtom = Atom.make(
  Effect.promise(async (): Promise<AuthClientSession | null> => {
    const result = await authClient.getSession();
    return result.data;
  })
).pipe(Atom.setIdleTTL("5 minutes"));

/**
 * Shared by React and router callbacks so both surfaces see the same atom.
 * Apps mount this registry through `AuthProvider`.
 */
export const authAtomRegistry = AtomRegistry.make();

/** Read the confirmed session currently held by the atom without fetching. */
export const getCachedAuthSession = (): AuthClientSession | null => {
  const result = authAtomRegistry.get(meAtom);
  return AsyncResult.isSuccess(result) ? result.value : null;
};

/** Resolve the initial session, waiting for the atom's in-flight request. */
export const getAuthSession = (): Promise<AuthClientSession | null> =>
  Effect.runPromise(
    AtomRegistry.getResult(authAtomRegistry, meAtom, {
      suspendOnWaiting: true,
    })
  );

/** Re-run Better Auth's session endpoint and resolve the reconciled value. */
export const refreshAuthSession = (): Promise<AuthClientSession | null> => {
  authAtomRegistry.refresh(meAtom);
  return getAuthSession();
};

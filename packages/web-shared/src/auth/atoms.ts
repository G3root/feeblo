import type { AuthClientSession } from "@feeblo/auth/client";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
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
// Better Auth reports a signed-out user as a successful `null` result. Transport
// and server failures are kept in the Effect error channel so consumers can
// distinguish them from an authoritative signed-out response.
// ---------------------------------------------------------------------------

export class AuthSessionRequestError extends Schema.TaggedErrorClass<AuthSessionRequestError>()(
  "AuthSessionRequestError",
  { cause: Schema.Defect }
) {}

export const meAtom = Atom.make(
  Effect.gen(function* () {
    const result = yield* Effect.promise(() => authClient.getSession());
    if (result.error) {
      return yield* new AuthSessionRequestError({ cause: result.error });
    }
    return result.data;
  })
).pipe(
  Atom.swr({
    staleTime: "5 minutes",
    revalidateOnFocus: "always",
    focusSignal: Atom.windowFocusSignal,
  }),
  Atom.setIdleTTL("5 minutes")
);

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

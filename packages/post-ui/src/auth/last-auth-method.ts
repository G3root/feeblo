import { isString } from "@feeblo/utils/runtime-kind";
import { authClient } from "@feeblo/web-shared/auth-client";
import { useSyncExternalStore } from "react";

import type { SocialProvider } from "./auth-flows";

/**
 * The three ways into an account. `email` covers both sign-in and sign-up: the
 * hint answers "how did this person get in last time", not "which form did they
 * use".
 */
export type AuthMethod = "email" | SocialProvider;

/**
 * Display-only memory of the last successful sign-in method.
 *
 * This is better-auth's `lastLoginMethod` plugin, not a store of our own. The
 * server half (`lastLoginMethod({ storeInDatabase: true })`) has been enabled
 * in `packages/auth/src/server.ts` all along; it writes
 * `better-auth.last_used_login_method` — a readable, non-HttpOnly cookie — on
 * every response that sets a session, and records `user.lastLoginMethod` on the
 * row. The value is therefore already correct for every method and every
 * surface, including the public board's auth dialog, with nothing to remember
 * at each call site.
 *
 * A `localStorage` key of our own was the first version of this, and it was
 * worse in every way: it only knew about methods it happened to observe, it was
 * wrong on any other device, and it duplicated a mechanism that already existed.
 *
 * Reading is the only thing left to do here, and it has to happen outside
 * React: the cookie does not exist while the server renders the document, so
 * `useSyncExternalStore` with a `null` server snapshot is the primitive that
 * keeps the markup identical through hydration and then reads the real value on
 * the first client render.
 */
const isAuthMethod = (value: string): value is AuthMethod =>
  value === "email" || value === "github" || value === "google";

/** `null` when nothing has been recorded, or when the cookie holds junk. */
export function readLastAuthMethod(): AuthMethod | null {
  const stored = authClient.getLastUsedLoginMethod();

  return isString(stored) && isAuthMethod(stored) ? stored : null;
}

/**
 * Cookies do not notify, and the value only changes on a sign-in, which
 * navigates. A subscription that does nothing is the honest shape: the hook
 * re-reads after hydration and on every render, and never needs an update.
 */
const subscribe = () => () => {
  // Nothing to unsubscribe from; see above.
};

const getServerSnapshot = (): AuthMethod | null => null;

export function useLastAuthMethod(): AuthMethod | null {
  return useSyncExternalStore(subscribe, readLastAuthMethod, getServerSnapshot);
}

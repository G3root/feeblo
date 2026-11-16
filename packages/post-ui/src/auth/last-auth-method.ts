import { isString } from "@feeblo/utils/runtime-kind";
import { useSyncExternalStore } from "react";

import type { SocialProvider } from "./auth-flows";

/**
 * The three ways into an account, in the order the sign-in page offers them.
 * `email` covers both sign-in and sign-up: the hint answers "how did this
 * person get in last time", not "which form did they use".
 */
export type AuthMethod = "email" | SocialProvider;

/**
 * Display-only memory of the last successful sign-in method.
 *
 * Local to the device on purpose. The server has no business knowing which
 * button someone pressed, and the hint is worthless on a device that never
 * signed in, so a per-device key is both the correct scope and the cheapest
 * place to keep it. Nothing here is an authorization decision: a wrong or
 * missing value changes one badge, never which methods work.
 */
const storageKey = "feeblo:last-sign-in-method";

function isAuthMethod(value: string): value is AuthMethod {
  return value === "email" || value === "github" || value === "google";
}

/** `null` when nothing has been recorded, storage is off, or the value is junk. */
export function readLastAuthMethod(): AuthMethod | null {
  try {
    const stored = window.localStorage.getItem(storageKey);

    return isString(stored) && isAuthMethod(stored) ? stored : null;
  } catch {
    // Safari's private mode throws on both access and write. The hint is a
    // convenience, so an unreadable store degrades to "no hint".
    return null;
  }
}

export function rememberAuthMethod(method: AuthMethod): void {
  try {
    window.localStorage.setItem(storageKey, method);
  } catch {
    // See `readLastAuthMethod`: losing the hint is not worth an error path.
  }
}

/**
 * The recorded method, read as an external store.
 *
 * Not `useState` + `useEffect`: that pattern paints the button without its hint
 * and then repaints with it, which is an extra render and a visible pop for a
 * value React can read on the first client render. `useSyncExternalStore` is
 * the primitive for exactly this — a value that lives outside React — and its
 * server snapshot is `null`, so hydration compares two identical documents and
 * the value arrives on the first render after it.
 *
 * The subscription is `storage`: signing in on this tab navigates, so the only
 * way the value changes underneath a mounted page is another tab.
 */
function subscribe(onStoreChange: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    // `key === null` is `localStorage.clear()`, which drops this key too.
    if (event.key === storageKey || event.key === null) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener("storage", onStorage);
  };
}

const getServerSnapshot = (): AuthMethod | null => null;

export function useLastAuthMethod(): AuthMethod | null {
  return useSyncExternalStore(subscribe, readLastAuthMethod, getServerSnapshot);
}

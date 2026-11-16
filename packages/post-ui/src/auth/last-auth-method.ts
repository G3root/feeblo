import { isString } from "@feeblo/utils/runtime-kind";
import { useEffect, useState } from "react";

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
 * The recorded method, read after mount.
 *
 * `localStorage` does not exist while the server renders the document, so the
 * first render cannot know the answer. Returning `null` until the effect runs
 * keeps hydration identical and lets the badge arrive on its own rather than
 * disagree with the markup it was hydrated from.
 */
export function useLastAuthMethod(): AuthMethod | null {
  const [method, setMethod] = useState<AuthMethod | null>(null);

  useEffect(() => {
    setMethod(readLastAuthMethod());
  }, []);

  return method;
}

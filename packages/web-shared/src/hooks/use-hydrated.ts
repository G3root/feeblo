import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;

/**
 * Whether React has hydrated this document.
 *
 * The server and the hydrating client render both read `false`; once hydration
 * commits the value flips to `true`. Because the client snapshot stays true
 * afterwards, a hydration fallback is never rendered again on a client-side
 * route transition.
 *
 * Use it where a server render has to agree with the first client render but
 * the browser-only behaviour must start immediately afterwards.
 */
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  );

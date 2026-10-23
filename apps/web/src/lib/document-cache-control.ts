import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

import { cookieName } from "@/paraglide/runtime.js";

/**
 * The cache policy for a document whose markup is the same for every visitor.
 *
 * The dashboard is `ssr: false`, so its response body is the pending shell,
 * the `<head>`, and the pre-hydration scripts — the session is resolved in the
 * browser and never reaches the markup. The root loader contributes deployment
 * values only (public env, `NO_INDEX`, preconnect origins). That makes the
 * document shareable, exactly like the public board's, and it is worth sharing:
 * without a policy every navigation to a dashboard URL re-invokes the worker
 * and re-renders 12 kB that the edge could have answered.
 *
 * Two things in the body are not constant, and neither identifies a visitor:
 *
 *   - `<html lang>`, rendered from the locale cookie by paraglide's middleware.
 *     A cookie-bearing request therefore renders (and must cache) per locale,
 *     while a cookie-less document is the same for every visitor. The
 *     pre-hydration `localeScript` corrects `lang`/`dir` from the cookie before
 *     first paint anyway, so the shared variant is never wrong for long.
 *   - The router's dehydrated state carries the moment the shell was rendered
 *     (`updatedAt`), which is a freshness marker, not an identity. Serving one
 *     visitor's timestamp to another is exactly what a shared cache does for
 *     any SSR'd document.
 *
 * The session never reaches this markup: auth is resolved in the browser, and
 * the auth hint the document reads is a cookie the client parses itself.
 *
 * Follows the public board's policy (`routes/s/route.tsx`) so the two documents
 * cannot disagree: a short shared TTL with `stale-while-revalidate` long enough
 * to absorb a deploy or a cold cache, and no caching at all once the visitor
 * has chosen a locale.
 */
export const getClientOnlyDocumentCacheControl = createIsomorphicFn()
  .client(() => undefined)
  .server(() => {
    const cookieHeader = getRequest().headers.get("cookie") ?? "";
    const hasLocaleCookie = cookieHeader
      .split(";")
      .some((entry) => entry.trim().startsWith(`${cookieName}=`));

    return hasLocaleCookie
      ? "private, max-age=0, must-revalidate"
      : "public, s-maxage=60, stale-while-revalidate=300";
  });

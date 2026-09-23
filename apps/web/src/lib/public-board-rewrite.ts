import { extractSubdomain } from "@feeblo/utils/url";

/**
 * The subdomain routing rules, as pure functions.
 *
 * The Astro app rewrote board hosts in middleware (`context.rewrite`), which
 * left the browser URL alone and required `Astro.locals.publicPath` to
 * remember what the visitor actually asked for. TanStack Router's `rewrite`
 * pair replaces both halves: `input` maps the public URL onto the internal
 * `/s/...` route on the server and in the browser, and `output` maps it back
 * so links and `history` keep the public path. That symmetry is what lets the
 * public board's canonical URL and the board's own client router agree with
 * the visitor's address bar.
 *
 * `src/router.tsx` wires these to the request host; keeping the decisions
 * here (and free of runtime lookups) is what makes them testable.
 */

export const DASHBOARD_SUBDOMAIN = "app";
export const PUBLIC_BOARD_PREFIX = "/s";
export const FEEDBACK_WIDGET_PATH = "/feedback-widget";

/**
 * Auth pages must stay reachable from a public board subdomain: rewriting
 * them under `/s/...` would render the board's not-found page because the
 * board router has no auth routes. Serving them from the dashboard app on the
 * current host keeps sign-in, sign-up, and password recovery working for
 * visitors on public endpoints.
 */
export const DASHBOARD_AUTH_PATHS: ReadonlySet<string> = new Set([
  "/sign-in",
  "/sign-up",
  "/email-verify",
  "/forgot-password",
  "/reset-password",
]);

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function resolveSubdomain(hostname: string, rootDomain: string) {
  return extractSubdomain({ url: `http://${hostname}`, rootDomain });
}

/**
 * Whether a host serves the dashboard (apex, `app.`, or an unrelated host the
 * deployment cannot classify — the middleware's fallback is the dashboard).
 */
export function isDashboardHost(hostname: string, rootDomain: string) {
  const subdomain = resolveSubdomain(hostname, rootDomain);
  return !subdomain || subdomain.toLowerCase() === DASHBOARD_SUBDOMAIN;
}

function isFeedbackWidgetPath(pathname: string) {
  return (
    pathname === FEEDBACK_WIDGET_PATH ||
    pathname.startsWith(`${FEEDBACK_WIDGET_PATH}/`)
  );
}

function isPublicBoardPath(pathname: string) {
  return (
    pathname === PUBLIC_BOARD_PREFIX ||
    pathname.startsWith(`${PUBLIC_BOARD_PREFIX}/`)
  );
}

/**
 * The internal path a public URL resolves to. Board hosts fold their pages
 * under `/s/...`; everything else passes through.
 */
export function toInternalPath(
  pathname: string,
  hostname: string,
  rootDomain: string
) {
  if (isDashboardHost(hostname, rootDomain)) {
    return pathname;
  }

  if (isFeedbackWidgetPath(pathname) || isPublicBoardPath(pathname)) {
    return pathname;
  }

  if (DASHBOARD_AUTH_PATHS.has(normalizePathname(pathname))) {
    return pathname;
  }

  if (pathname === "/") {
    return `${PUBLIC_BOARD_PREFIX}/`;
  }

  return `${PUBLIC_BOARD_PREFIX}${pathname}`;
}

/**
 * The public spelling of an internal path. Board hosts drop the `/s` prefix
 * they never show the visitor.
 */
export function toPublicPath(
  pathname: string,
  hostname: string,
  rootDomain: string
) {
  if (isDashboardHost(hostname, rootDomain)) {
    return pathname;
  }

  if (pathname === PUBLIC_BOARD_PREFIX) {
    return "/";
  }

  if (pathname.startsWith(`${PUBLIC_BOARD_PREFIX}/`)) {
    return pathname.slice(PUBLIC_BOARD_PREFIX.length);
  }

  return pathname;
}

export interface PublicBoardRewrite {
  readonly input: ({ url }: { url: URL }) => URL;
  readonly output: ({ url }: { url: URL }) => URL;
}

/**
 * The router `rewrite` pair. `getRootDomain` is a callback because the value
 * is request-scoped on the server (Workers inject env per request) and only
 * known after the root env script on the client.
 */
export function createPublicBoardRewrite(
  getRootDomain: () => string
): PublicBoardRewrite {
  return {
    input: ({ url }) => {
      const pathname = toInternalPath(
        url.pathname,
        url.hostname,
        getRootDomain()
      );
      if (pathname !== url.pathname) {
        url.pathname = pathname;
      }
      return url;
    },
    output: ({ url }) => {
      const pathname = toPublicPath(
        url.pathname,
        url.hostname,
        getRootDomain()
      );
      if (pathname !== url.pathname) {
        url.pathname = pathname;
      }
      return url;
    },
  };
}

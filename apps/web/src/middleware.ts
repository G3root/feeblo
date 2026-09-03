import { extractSubdomain } from "@feeblo/utils/url";
import type { APIContext, MiddlewareNext } from "astro";
import { defineMiddleware, sequence } from "astro:middleware";

import { getServerRuntimePublicEnv } from "~/lib/server-runtime-public-env";

import { paraglideMiddleware } from "./paraglide/server";

export const localeMiddleware = defineMiddleware(async (context, next) => {
  // Avoid consuming bodies for non-GET/HEAD requests
  // https://github.com/opral/paraglide-js/issues/564
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return next(context.request);
  }
  return paraglideMiddleware(context.request, ({ request }) => next(request));
});

const DASHBOARD_PATH = "/";
const PUBLIC_BOARD_PATH = "/s";
const FEEDBACK_WIDGET_PATH = "/feedback-widget";
const DASHBOARD_SUBDOMAIN = "app";
const DASHBOARD_AUTH_PATHS = new Set([
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

function isFeedbackWidgetPath(pathname: string) {
  return (
    pathname === FEEDBACK_WIDGET_PATH ||
    pathname.startsWith(`${FEEDBACK_WIDGET_PATH}/`)
  );
}

function resolveSubdomain(context: APIContext) {
  return extractSubdomain({
    url: context.request.url,
    rootDomain: getServerRuntimePublicEnv().appRootDomain,
  });
}

function getTargetPathPrefix(subdomain: string | null) {
  if (
    !subdomain ||
    (subdomain && subdomain.toLowerCase() === DASHBOARD_SUBDOMAIN)
  ) {
    return DASHBOARD_PATH;
  }

  return PUBLIC_BOARD_PATH;
}

function hasPathPrefix(pathname: string, prefix: string) {
  if (prefix === DASHBOARD_PATH) {
    return true;
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isPublicBoardSubdomain(subdomain: string | null): subdomain is string {
  return Boolean(subdomain && subdomain.toLowerCase() !== DASHBOARD_SUBDOMAIN);
}

function subdomainMiddleware(context: APIContext, next: MiddlewareNext) {
  const subdomain = resolveSubdomain(context);
  context.locals.subdomain = subdomain;
  const targetPathPrefix = getTargetPathPrefix(subdomain);
  const pathname = normalizePathname(context.url.pathname);
  // The path the visitor requested, before any rewrite. Pages (and the
  // canonical URLs they render) must reflect this, not the internal rewrite
  // target. First write wins: if the middleware sequence re-runs after a
  // rewrite, the original path is already stashed.
  if (context.locals.publicPath === undefined) {
    context.locals.publicPath = pathname;
  }

  if (isFeedbackWidgetPath(pathname)) {
    return next();
  }

  if (!hasPathPrefix(pathname, targetPathPrefix)) {
    // Dashboard auth pages must stay reachable from a public board subdomain:
    // rewriting them under the public board (/s/...) would render the board's
    // not-found page because the board router has no auth routes. Serving them
    // from the dashboard app on the current host keeps sign-in, sign-up, and
    // password recovery working for visitors on public endpoints.
    if (DASHBOARD_AUTH_PATHS.has(pathname)) {
      return next();
    }
    const suffix = pathname === "/" ? "" : pathname;
    return context.rewrite(`${targetPathPrefix}${suffix}${context.url.search}`);
  }

  return next();
}

async function siteMiddleware(context: APIContext, next: MiddlewareNext) {
  const pathname = normalizePathname(context.url.pathname);
  if (isFeedbackWidgetPath(pathname)) {
    return next();
  }

  const { subdomain } = context.locals;
  if (isPublicBoardSubdomain(subdomain)) {
    try {
      // The Effect RPC runtime (~150 kB) is only needed to resolve the site
      // for public board subdomains. Load it lazily so dashboard/app requests
      // never evaluate it, keeping it out of the worker's startup module graph.
      const { fetchRpcServer } = await import("~/lib/runtime-server");
      const sites = await fetchRpcServer((rpc) =>
        rpc.SiteListBySubdomain({ subdomain })
      );
      context.locals.site = sites[0] ?? null;
    } catch (error) {
      console.error("Failed to fetch site for subdomain", subdomain, error);
      context.locals.site = null;
    }
  } else {
    context.locals.site = null;
  }

  return next();
}

// Session resolution and the session-aware redirects (sign-in bounce,
// register bounce, default-organization canonicalization) moved to the client:
// see `~/lib/auth-redirects` in the dashboard app. Documents no longer embed a
// server-resolved auth hint, so they are user-independent and need no
// `private, no-store` cache treatment.

export const onRequest = sequence(
  localeMiddleware,
  subdomainMiddleware,
  siteMiddleware
);

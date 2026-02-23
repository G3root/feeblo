import { sequence } from "astro:middleware";
import type { APIContext, MiddlewareNext } from "astro";
import { authClient } from "~/lib/auth-client";

const DASHBOARD_TARGET_PREFIX = "/dashboard";
const SUBDOMAIN_TARGET_PREFIX = "/s";
const AUTH_SIGN_IN_PATH = "/sign-in";
const AUTH_SIGN_UP_PATH = "/sign-up";
const APP_HOME_PATH = "/";
const DASHBOARD_AUTH_PATHS = new Set([
  `${DASHBOARD_TARGET_PREFIX}${AUTH_SIGN_IN_PATH}`,
  `${DASHBOARD_TARGET_PREFIX}${AUTH_SIGN_UP_PATH}`,
]);

function resolveSubdomain(_context: APIContext) {
  return "app";
}

function getTargetPathPrefix(subdomain: string | null) {
  if (!subdomain) {
    return null;
  }
  return subdomain === "app"
    ? DASHBOARD_TARGET_PREFIX
    : SUBDOMAIN_TARGET_PREFIX;
}

function getProjectedPathname(
  pathname: string,
  targetPathPrefix: string | null
) {
  if (!targetPathPrefix || pathname.startsWith(targetPathPrefix)) {
    return pathname;
  }

  return pathname === "/" ? targetPathPrefix : `${targetPathPrefix}${pathname}`;
}

async function authMiddleware(context: APIContext, next: MiddlewareNext) {
  const session = await authClient.getSession({
    fetchOptions: {
      headers: context.request.headers,
    },
  });

  if (session?.data) {
    context.locals.user = session.data.user;
    context.locals.session = session.data.session;
  } else {
    context.locals.user = null;
    context.locals.session = null;
  }

  return next();
}

function dashboardAuthRedirectMiddleware(
  context: APIContext,
  next: MiddlewareNext
) {
  const { url } = context;
  const targetPathPrefix = getTargetPathPrefix(resolveSubdomain(context));
  const projectedPathname = getProjectedPathname(
    url.pathname,
    targetPathPrefix
  );

  const isDashboardPath =
    projectedPathname === DASHBOARD_TARGET_PREFIX ||
    projectedPathname.startsWith(`${DASHBOARD_TARGET_PREFIX}/`);

  if (!isDashboardPath) {
    return next();
  }

  const isAuthPath = DASHBOARD_AUTH_PATHS.has(projectedPathname);
  const isAuthed = Boolean(context.locals.session);

  if (!(isAuthed || isAuthPath)) {
    const redirectURL = new URL(AUTH_SIGN_IN_PATH, url);
    redirectURL.searchParams.set("redirectTo", `${url.pathname}${url.search}`);
    return context.redirect(redirectURL.toString());
  }

  if (isAuthed && isAuthPath) {
    return context.redirect(APP_HOME_PATH);
  }

  return next();
}

function redirectMiddleware(context: APIContext, next: MiddlewareNext) {
  const { url } = context;
  const targetPathPrefix = getTargetPathPrefix(resolveSubdomain(context));

  if (targetPathPrefix) {
    const projectedPathname = getProjectedPathname(
      url.pathname,
      targetPathPrefix
    );

    if (projectedPathname !== url.pathname) {
      return context.rewrite(projectedPathname);
    }
  }

  return next();
}

export const onRequest = sequence(
  authMiddleware,
  dashboardAuthRedirectMiddleware,
  redirectMiddleware
);

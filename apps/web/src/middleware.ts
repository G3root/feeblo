import { sequence } from "astro:middleware";
import type { APIContext, MiddlewareNext } from "astro";
import { authClient } from "~/lib/auth-client";

const AUTH_SIGN_IN_PATH = "/sign-in";
const AUTH_SIGN_UP_PATH = "/sign-up";
const APP_HOME_PATH = "/";
const DASHBOARD_AUTH_PATHS = new Set([AUTH_SIGN_IN_PATH, AUTH_SIGN_UP_PATH]);

function resolveSubdomain(_context: APIContext) {
  return "app";
}

function getTargetPathPrefix(subdomain: string | null) {
  if (!subdomain) {
    return null;
  }

  return subdomain === "app" ? APP_HOME_PATH : null;
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
    context.locals.organizations = session.data.organizations;
  } else {
    context.locals.user = null;
    context.locals.session = null;
    context.locals.organizations = null;
  }

  return next();
}

function getMemberOrganizationIds(context: APIContext) {
  return (context.locals.organizations ?? [])
    .map((org) => org.id)
    .filter(Boolean);
}

function getPathOrganizationId(pathname: string) {
  const [segment] = pathname.slice(1).split("/");
  return segment || null;
}

function getDefaultOrganizationId(context: APIContext) {
  const organizationIds = getMemberOrganizationIds(context);
  if (organizationIds.length === 0) {
    return null;
  }
  return organizationIds[0] ?? null;
}

function dashboardAuthRedirectMiddleware(
  context: APIContext,
  next: MiddlewareNext
) {
  const { url } = context;
  const targetPathPrefix = getTargetPathPrefix(resolveSubdomain(context));
  const isAppSubdomain = targetPathPrefix === APP_HOME_PATH;
  if (!isAppSubdomain) {
    return next();
  }

  const isAuthPath = DASHBOARD_AUTH_PATHS.has(url.pathname);
  const isAuthed = Boolean(context.locals.session);

  if (!(isAuthed || isAuthPath)) {
    const redirectURL = new URL(AUTH_SIGN_IN_PATH, url);
    redirectURL.searchParams.set("redirectTo", `${url.pathname}${url.search}`);
    return context.redirect(redirectURL.toString());
  }

  if (isAuthed && isAuthPath) {
    const organizationId = getDefaultOrganizationId(context);
    return context.redirect(organizationId ? `/${organizationId}` : APP_HOME_PATH);
  }

  return next();
}

function redirectMiddleware(context: APIContext, next: MiddlewareNext) {
  const { url } = context;
  const targetPathPrefix = getTargetPathPrefix(resolveSubdomain(context));
  const organizationIds = getMemberOrganizationIds(context);
  const defaultOrganizationId = getDefaultOrganizationId(context);

  if (targetPathPrefix !== APP_HOME_PATH || !defaultOrganizationId) {
    return next();
  }

  if (DASHBOARD_AUTH_PATHS.has(url.pathname)) {
    return next();
  }

  const pathOrganizationId = getPathOrganizationId(url.pathname);
  if (pathOrganizationId && organizationIds.includes(pathOrganizationId)) {
    return next();
  }

  if (pathOrganizationId) {
    const pathnameWithoutOrg = url.pathname.slice(pathOrganizationId.length + 1);
    const suffix = pathnameWithoutOrg ? pathnameWithoutOrg : "";
    return context.redirect(`/${defaultOrganizationId}${suffix}${url.search}`);
  }

  const suffix = url.pathname === "/" ? "" : url.pathname;
  return context.redirect(`/${defaultOrganizationId}${suffix}${url.search}`);
}

export const onRequest = sequence(
  authMiddleware,
  dashboardAuthRedirectMiddleware,
  redirectMiddleware
);

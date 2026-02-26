import { VITE_APP_ROOT_DOMAIN } from "astro:env/client";
import { sequence } from "astro:middleware";
import { extractSubdomain } from "@feeblo/utils/url";
import type { APIContext, MiddlewareNext } from "astro";
import { authClient } from "~/lib/auth-client";

const AUTH_SIGN_IN_PATH = "/sign-in";
const AUTH_SIGN_UP_PATH = "/sign-up";
const APP_HOME_PATH = "/";
const PUBLIC_BOARD_PATH = "/s";
const DASHBOARD_AUTH_PATHS = new Set([AUTH_SIGN_IN_PATH, AUTH_SIGN_UP_PATH]);

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function resolveSubdomain(context: APIContext) {
  return extractSubdomain({
    url: context.request.url,
    rootDomain: VITE_APP_ROOT_DOMAIN,
  });
}

function getTargetPathPrefix(subdomain: string | null) {
  if (!subdomain) {
    return null;
  }

  return subdomain === "app" ? APP_HOME_PATH : PUBLIC_BOARD_PATH;
}

function subdomainMiddleware(context: APIContext, next: MiddlewareNext) {
  context.locals.subdomain = resolveSubdomain(context);
  return next();
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
  const pathname = normalizePathname(url.pathname);
  const targetPathPrefix = getTargetPathPrefix(context.locals.subdomain);
  const isAppSubdomain = targetPathPrefix === APP_HOME_PATH;
  if (!isAppSubdomain) {
    return next();
  }

  const isAuthPath = DASHBOARD_AUTH_PATHS.has(pathname);
  const isAuthed = Boolean(context.locals.session);

  if (!(isAuthed || isAuthPath)) {
    const redirectURL = new URL(AUTH_SIGN_IN_PATH, url);
    redirectURL.searchParams.set("redirectTo", `${url.pathname}${url.search}`);
    return context.redirect(redirectURL.toString());
  }

  if (isAuthed && isAuthPath) {
    const organizationId = getDefaultOrganizationId(context);
    return context.redirect(
      organizationId ? `/${organizationId}` : APP_HOME_PATH
    );
  }

  return next();
}

function redirectMiddleware(context: APIContext, next: MiddlewareNext) {
  const { url } = context;
  const pathname = normalizePathname(url.pathname);
  const targetPathPrefix = getTargetPathPrefix(context.locals.subdomain);
  const organizationIds = getMemberOrganizationIds(context);
  const defaultOrganizationId = getDefaultOrganizationId(context);

  if (targetPathPrefix === PUBLIC_BOARD_PATH) {
    const isAlreadyInBoardPath =
      pathname === PUBLIC_BOARD_PATH ||
      pathname.startsWith(`${PUBLIC_BOARD_PATH}/`);

    if (isAlreadyInBoardPath) {
      return next();
    }

    const suffix = pathname === "/" ? "" : pathname;
    return context.rewrite(`${PUBLIC_BOARD_PATH}${suffix}${url.search}`);
  }

  if (targetPathPrefix !== APP_HOME_PATH || !defaultOrganizationId) {
    return next();
  }

  if (DASHBOARD_AUTH_PATHS.has(pathname)) {
    return next();
  }

  const pathOrganizationId = getPathOrganizationId(pathname);
  if (pathOrganizationId && organizationIds.includes(pathOrganizationId)) {
    return next();
  }

  if (pathOrganizationId) {
    const pathnameWithoutOrg = pathname.slice(pathOrganizationId.length + 1);
    const suffix = pathnameWithoutOrg ? pathnameWithoutOrg : "";
    return context.redirect(`/${defaultOrganizationId}${suffix}${url.search}`);
  }

  const suffix = pathname === "/" ? "" : pathname;
  return context.redirect(`/${defaultOrganizationId}${suffix}${url.search}`);
}

export const onRequest = sequence(
  subdomainMiddleware,
  authMiddleware,
  dashboardAuthRedirectMiddleware,
  redirectMiddleware
);

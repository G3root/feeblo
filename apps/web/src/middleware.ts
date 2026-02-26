/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { VITE_APP_ROOT_DOMAIN } from "astro:env/client";
import { sequence } from "astro:middleware";
import { extractSubdomain, RESERVED_SUBDOMAINS } from "@feeblo/utils/url";
import type { APIContext, MiddlewareNext } from "astro";
import { authClient } from "~/lib/auth-client";

const AUTH_SIGN_IN_PATH = "/sign-in";
const AUTH_SIGN_UP_PATH = "/sign-up";
const DASHBOARD_PATH = "/";
const PUBLIC_BOARD_PATH = "/s";
const DASHBOARD_AUTH_PATHS = new Set([AUTH_SIGN_IN_PATH, AUTH_SIGN_UP_PATH]);

const RESERVED_SUBDOMAIN_SET = new Set(RESERVED_SUBDOMAINS);

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
  if (subdomain && !RESERVED_SUBDOMAIN_SET.has(subdomain)) {
    return PUBLIC_BOARD_PATH;
  }

  return DASHBOARD_PATH;
}

function hasPathPrefix(pathname: string, prefix: string) {
  if (prefix === DASHBOARD_PATH) {
    return true;
  }
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function stripLeadingSegment(pathname: string, segment: string) {
  if (pathname === `/${segment}`) {
    return "";
  }
  return pathname.slice(segment.length + 1);
}

function subdomainMiddleware(context: APIContext, next: MiddlewareNext) {
  const subdomain = resolveSubdomain(context);
  context.locals.subdomain = subdomain;
  const targetPathPrefix = getTargetPathPrefix(subdomain);
  const pathname = normalizePathname(context.url.pathname);

  if (!hasPathPrefix(pathname, targetPathPrefix)) {
    const suffix = pathname === "/" ? "" : pathname;
    return context.rewrite(`${targetPathPrefix}${suffix}${context.url.search}`);
  }

  return next();
}

async function authMiddleware(context: APIContext, next: MiddlewareNext) {
  const { data } = await authClient.getSession({
    fetchOptions: { headers: context.request.headers },
  });

  context.locals.user = data?.user ?? null;
  context.locals.session = data?.session ?? null;
  context.locals.organizations = data?.organizations ?? null;

  return next();
}

function getMemberOrganizationIds(context: APIContext) {
  return (context.locals.organizations ?? []).map((org) => org.id);
}

function getPathOrganizationId(pathname: string) {
  const [segment] = pathname.slice(1).split("/");
  return segment || null;
}

function getDefaultOrganizationId(context: APIContext) {
  return getMemberOrganizationIds(context)[0] ?? null;
}

function dashboardAuthRedirectMiddleware(
  context: APIContext,
  next: MiddlewareNext
) {
  const { url } = context;
  const pathname = normalizePathname(url.pathname);
  const targetPathPrefix = getTargetPathPrefix(context.locals.subdomain);
  const isAppSubdomain = targetPathPrefix === DASHBOARD_PATH;
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
      organizationId ? `/${organizationId}` : DASHBOARD_PATH
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

  if (targetPathPrefix !== DASHBOARD_PATH || !defaultOrganizationId) {
    return next();
  }

  if (DASHBOARD_AUTH_PATHS.has(pathname)) {
    return next();
  }

  const pathOrganizationId = getPathOrganizationId(pathname);
  if (pathOrganizationId && organizationIds.includes(pathOrganizationId)) {
    return next();
  }

  const suffix =
    pathOrganizationId && pathname !== "/"
      ? stripLeadingSegment(pathname, pathOrganizationId)
      : pathname === "/"
        ? ""
        : pathname;
  return context.redirect(`/${defaultOrganizationId}${suffix}${url.search}`);
}

export const onRequest = sequence(
  authMiddleware,
  subdomainMiddleware,
  dashboardAuthRedirectMiddleware,
  redirectMiddleware
);

/** biome-ignore-all lint/style/noNestedTernary: <explanation> */
import { sequence } from "astro:middleware";
import { extractSubdomain } from "@feeblo/utils/url";
import type { APIContext, MiddlewareNext } from "astro";
import { authClient } from "~/lib/server-auth-client";
import { getServerRuntimePublicEnv } from "~/lib/server-runtime-public-env";

const AUTH_SIGN_IN_PATH = "/sign-in";
const AUTH_SIGN_UP_PATH = "/sign-up";
const AUTH_EMAIL_VERIFY_PATH = "/email-verify";
const REGISTER_PATH = "/register";
const DASHBOARD_PATH = "/";
const PUBLIC_BOARD_PATH = "/s";
const EMBED_PATH = "/e";
const DASHBOARD_AUTH_PATHS = new Set([
  AUTH_SIGN_IN_PATH,
  AUTH_SIGN_UP_PATH,
  AUTH_EMAIL_VERIFY_PATH,
]);
const DASHBOARD_NON_ORG_PATHS = new Set([
  ...DASHBOARD_AUTH_PATHS,
  REGISTER_PATH,
]);

function normalizePathname(pathname: string) {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.slice(0, -1);
  }
  return pathname;
}

function isEmbedPath(pathname: string) {
  return pathname === EMBED_PATH || pathname.startsWith(`${EMBED_PATH}/`);
}

function resolveSubdomain(context: APIContext) {
  return extractSubdomain({
    url: context.request.url,
    rootDomain: getServerRuntimePublicEnv().appRootDomain,
  });
}

function getTargetPathPrefix(subdomain: string | null) {
  if (!subdomain || (subdomain && subdomain.toLowerCase() === "app")) {
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

  if (isEmbedPath(pathname)) {
    return next();
  }

  if (!hasPathPrefix(pathname, targetPathPrefix)) {
    const suffix = pathname === "/" ? "" : pathname;
    return context.rewrite(`${targetPathPrefix}${suffix}${context.url.search}`);
  }

  return next();
}

async function authMiddleware(context: APIContext, next: MiddlewareNext) {
  if (isEmbedPath(normalizePathname(context.url.pathname))) {
    return next();
  }

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

function hasOrganizations(context: APIContext) {
  return getMemberOrganizationIds(context).length > 0;
}

function dashboardAuthRedirectMiddleware(
  context: APIContext,
  next: MiddlewareNext
) {
  const { url } = context;
  const pathname = normalizePathname(url.pathname);

  if (isEmbedPath(pathname)) {
    return next();
  }

  const targetPathPrefix = getTargetPathPrefix(context.locals.subdomain);
  const isAppSubdomain = targetPathPrefix === DASHBOARD_PATH;
  if (!isAppSubdomain) {
    return next();
  }

  const isAuthPath = DASHBOARD_AUTH_PATHS.has(pathname);
  const isAuthed = Boolean(context.locals.session);
  const isRegisterPath = pathname === REGISTER_PATH;
  const hasOrgs = hasOrganizations(context);

  if (!(isAuthed || isAuthPath)) {
    const redirectURL = new URL(AUTH_SIGN_IN_PATH, url);
    redirectURL.searchParams.set("redirectTo", `${url.pathname}${url.search}`);
    return context.redirect(redirectURL.toString());
  }

  if (isAuthed && !hasOrgs && !(isAuthPath || isRegisterPath)) {
    const redirectURL = new URL(REGISTER_PATH, url);
    redirectURL.searchParams.set("redirectTo", `${url.pathname}${url.search}`);
    return context.redirect(redirectURL.toString());
  }

  if (isAuthed && isAuthPath) {
    if (!hasOrgs) {
      return context.redirect(REGISTER_PATH);
    }

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

  if (isEmbedPath(pathname)) {
    return next();
  }

  const targetPathPrefix = getTargetPathPrefix(context.locals.subdomain);
  const organizationIds = getMemberOrganizationIds(context);
  const defaultOrganizationId = getDefaultOrganizationId(context);

  if (targetPathPrefix !== DASHBOARD_PATH || !defaultOrganizationId) {
    return next();
  }

  if (DASHBOARD_NON_ORG_PATHS.has(pathname)) {
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

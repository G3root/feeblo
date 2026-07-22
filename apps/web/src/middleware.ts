/** biome-ignore-all lint/style/noNestedTernary: Redirect suffixes mirror the route decision tree. */
import { sequence } from "astro:middleware";
import type { AuthClientSession } from "@feeblo/auth/client";
import { extractSubdomain } from "@feeblo/utils/url";
import type { AuthHint } from "@feeblo/web-shared/auth-hint";
import type { APIContext, MiddlewareNext } from "astro";
import { fetchRpcServer } from "~/lib/runtime-server";
import { authClient } from "~/lib/server-auth-client";
import { getServerRuntimePublicEnv } from "~/lib/server-runtime-public-env";

const AUTH_SIGN_IN_PATH = "/sign-in";
const AUTH_SIGN_UP_PATH = "/sign-up";
const AUTH_EMAIL_VERIFY_PATH = "/email-verify";
const REGISTER_PATH = "/register";
const DASHBOARD_PATH = "/";
const PUBLIC_BOARD_PATH = "/s";
const FEEDBACK_WIDGET_PATH = "/feedback-widget";
const DASHBOARD_SUBDOMAIN = "app";
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

function isFeedbackWidgetPath(pathname: string) {
  return (
    pathname === FEEDBACK_WIDGET_PATH ||
    pathname.startsWith(`${FEEDBACK_WIDGET_PATH}/`)
  );
}

function isDocumentRequest(request: Request) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return false;
  }

  const destination = request.headers.get("sec-fetch-dest");
  return (
    destination === "document" ||
    (!destination && request.headers.get("accept")?.includes("text/html"))
  );
}

async function documentCacheMiddleware(
  context: APIContext,
  next: MiddlewareNext
) {
  const response = await next();
  if (isDocumentRequest(context.request)) {
    // The document varies by the HttpOnly session cookie because it embeds a
    // server-verified display hint. Neither anonymous nor signed-in HTML may
    // enter a shared cache under this URL.
    response.headers.set("Cache-Control", "private, no-store");
  }
  return response;
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

function stripLeadingSegment(pathname: string, segment: string) {
  if (pathname === `/${segment}`) {
    return "";
  }
  return pathname.slice(segment.length + 1);
}

function isPublicBoardSubdomain(subdomain: string | null): subdomain is string {
  return Boolean(subdomain && subdomain.toLowerCase() !== DASHBOARD_SUBDOMAIN);
}

function subdomainMiddleware(context: APIContext, next: MiddlewareNext) {
  const subdomain = resolveSubdomain(context);
  context.locals.subdomain = subdomain;
  const targetPathPrefix = getTargetPathPrefix(subdomain);
  const pathname = normalizePathname(context.url.pathname);

  if (isFeedbackWidgetPath(pathname)) {
    return next();
  }

  if (!hasPathPrefix(pathname, targetPathPrefix)) {
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

async function authMiddleware(context: APIContext, next: MiddlewareNext) {
  if (isFeedbackWidgetPath(normalizePathname(context.url.pathname))) {
    context.locals.authHint = null;
    return next();
  }

  const { data } = await authClient.getSession({
    fetchOptions: { headers: context.request.headers },
  });

  const sessionData = data as AuthClientSession | null;

  // The HttpOnly Better Auth cookie remains the authority. Middleware resolves
  // it before serving the document; the display-only hint passed to the React
  // island below merely avoids a loading flash while `meAtom` reconciles.
  context.locals.user = sessionData?.user ?? null;
  context.locals.session = sessionData?.session ?? null;
  context.locals.organizations = sessionData?.organizations ?? null;

  if (sessionData?.user.restrictedToOrganizationId) {
    const { subdomain, site } = context.locals;
    if (isPublicBoardSubdomain(subdomain)) {
      if (
        !site ||
        site.organizationId !== sessionData.user.restrictedToOrganizationId
      ) {
        context.locals.user = null;
        context.locals.session = null;
        context.locals.organizations = null;
      }
    } else {
      context.locals.user = null;
      context.locals.session = null;
      context.locals.organizations = null;
    }
  }

  const { user } = context.locals;
  context.locals.authHint = user
    ? ({
        v: 1,
        user: {
          email: user.email,
          name: user.name,
          image: user.image ?? null,
        },
      } satisfies AuthHint)
    : null;

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

  if (isFeedbackWidgetPath(pathname)) {
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

  if (isFeedbackWidgetPath(pathname)) {
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
  documentCacheMiddleware,
  subdomainMiddleware,
  siteMiddleware,
  authMiddleware,
  dashboardAuthRedirectMiddleware,
  redirectMiddleware
);

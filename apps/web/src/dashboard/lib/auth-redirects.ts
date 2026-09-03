import type { AuthClientSession } from "@feeblo/auth/client";
import { extractSubdomain } from "@feeblo/utils/url";
import {
  getCachedAuthSession,
  getAuthSession,
} from "@feeblo/web-shared/auth-session";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { redirect } from "@tanstack/react-router";

// ---------------------------------------------------------------------------
// Client-side dashboard auth redirects.
//
// This module replaces the session-aware redirects that used to run in Astro
// middleware (`apps/web/src/middleware.ts`). The server no longer resolves the
// Better Auth session for document requests; the SPA resolves it through
// `meAtom` (via `getAuthSession`) and enforces the same rules in the root
// route's `beforeLoad`, before any route renders:
//
// 1. Anonymous visitors on non-auth pages are sent to sign-in, preserving the
//    deep link in `redirectTo`.
// 2. Signed-in users without an organization are sent to /register.
// 3. Signed-in users on auth pages are sent to their default organization,
//    except password recovery pages, which must stay reachable — e.g. on a
//    shared device — because they cannot create a session.
// 4. Paths missing a known organization-id prefix are canonicalized under the
//    default organization.
//
// The rules only run on the dashboard ("app") subdomain. On public board
// subdomains the server rewrites documents to /s/... and mounts this SPA only
// for the auth paths below, where no redirect applies.
// ---------------------------------------------------------------------------

const AUTH_SIGN_IN_PATH = "/sign-in";
const AUTH_SIGN_UP_PATH = "/sign-up";
const AUTH_EMAIL_VERIFY_PATH = "/email-verify";
const AUTH_FORGOT_PASSWORD_PATH = "/forgot-password";
const AUTH_RESET_PASSWORD_PATH = "/reset-password";
const REGISTER_PATH = "/register";
const DASHBOARD_SUBDOMAIN = "app";

const DASHBOARD_AUTH_PATHS = new Set([
  AUTH_SIGN_IN_PATH,
  AUTH_SIGN_UP_PATH,
  AUTH_EMAIL_VERIFY_PATH,
  AUTH_FORGOT_PASSWORD_PATH,
  AUTH_RESET_PASSWORD_PATH,
]);
const PASSWORD_RESET_PATHS = new Set([
  AUTH_FORGOT_PASSWORD_PATH,
  AUTH_RESET_PASSWORD_PATH,
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

function isAppSubdomainHost() {
  const { appRootDomain } = getRuntimePublicEnv();
  // Without the configured root domain we cannot tell board hosts from the
  // dashboard host; do not enforce dashboard-only redirects.
  if (!appRootDomain) {
    return false;
  }
  const subdomain = extractSubdomain({
    url: window.location.href,
    rootDomain: appRootDomain,
  });
  return !subdomain || subdomain.toLowerCase() === DASHBOARD_SUBDOMAIN;
}

function redirectToSignIn(location: BeforeLoadLocation): never {
  const redirectTo = encodeURIComponent(
    `${location.pathname}${location.searchStr}`
  );
  throw redirect({ href: `${AUTH_SIGN_IN_PATH}?redirectTo=${redirectTo}` });
}

function redirectToRegister(location: BeforeLoadLocation): never {
  const redirectTo = encodeURIComponent(
    `${location.pathname}${location.searchStr}`
  );
  throw redirect({ href: `${REGISTER_PATH}?redirectTo=${redirectTo}` });
}

interface BeforeLoadLocation {
  readonly pathname: string;
  readonly searchStr: string;
}

function getDefaultOrganizationId(session: AuthClientSession) {
  return session.organizations[0]?.id ?? null;
}

/**
 * TanStack Router `beforeLoad` guard enforcing the dashboard auth redirects.
 * Mounted on the root route so every navigation — including the initial
 * document load — resolves the session before any route renders.
 */
export async function dashboardAuthBeforeLoad({
  location,
}: {
  location: BeforeLoadLocation;
}): Promise<void> {
  if (!isAppSubdomainHost()) {
    return;
  }

  // A cached success is authoritative enough for routing decisions; do not
  // stall navigation behind an in-flight revalidation. Null also covers
  // cached failures and confirmed sign-outs, which fall through to the await
  // below — a settled atom resolves there without a network stall.
  let session: AuthClientSession | null = getCachedAuthSession();
  if (session === null) {
    try {
      session = await getAuthSession();
    } catch {
      // A transport failure means the session is unknown, not signed-out.
      // Leave routing untouched: protected routes stay behind their gates and
      // recover once the atom revalidates.
      return;
    }
  }

  // SSO-restricted users are scoped to their board subdomain; on the dashboard
  // they are treated as signed out exactly as the former middleware did.
  const effectiveSession =
    session?.user.restrictedToOrganizationId != null ? null : session;

  const pathname = normalizePathname(location.pathname);
  const isAuthPath = DASHBOARD_AUTH_PATHS.has(pathname);

  if (!effectiveSession) {
    if (!isAuthPath) {
      redirectToSignIn(location);
    }
    return;
  }

  const organizations = effectiveSession.organizations ?? [];
  const hasOrganizations = organizations.length > 0;
  const defaultOrganizationId = getDefaultOrganizationId(effectiveSession);
  const isRegisterPath = pathname === REGISTER_PATH;

  if (!hasOrganizations && !(isAuthPath || isRegisterPath)) {
    redirectToRegister(location);
  }

  if (isAuthPath && !PASSWORD_RESET_PATHS.has(pathname)) {
    if (!hasOrganizations) {
      throw redirect({ href: REGISTER_PATH });
    }

    throw redirect({
      href: defaultOrganizationId ? `/${defaultOrganizationId}` : "/",
    });
  }

  if (!defaultOrganizationId || DASHBOARD_NON_ORG_PATHS.has(pathname)) {
    return;
  }

  const [segment] = pathname.slice(1).split("/");
  const pathOrganizationId = segment || null;
  if (
    pathOrganizationId &&
    organizations.some((organization) => organization.id === pathOrganizationId)
  ) {
    // Already namespaced under a workspace the user belongs to.
    return;
  }

  // Mirror the former middleware: "/" and unrecognized top-level segments
  // alike canonicalize under the default workspace.
  const suffix =
    pathOrganizationId && pathname !== "/"
      ? pathname === `/${pathOrganizationId}`
        ? ""
        : pathname.slice(pathOrganizationId.length + 1)
      : "";
  throw redirect({
    href: `/${defaultOrganizationId}${suffix}${location.searchStr}`,
  });
}

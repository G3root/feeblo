import type { AuthClientSession } from "@feeblo/auth/client";
import { hasWindow } from "@feeblo/utils/runtime-kind";
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
const INVITATION_PATH_PREFIX = "/invitation/";
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

/**
 * An invitation is the one deep link that is valid for an account with no
 * workspace yet: accepting it creates the membership, so it must not be
 * canonicalized under a workspace id or redirected to registration.
 */
const isInvitationPath = (pathname: string) =>
  pathname.startsWith(INVITATION_PATH_PREFIX);

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
 * The session a routing decision may act on.
 *
 * `null` is an authoritative signed-out (or SSO-restricted) answer; `undefined`
 * means the session could not be resolved at all. The distinction matters: a
 * transport failure is not evidence a visitor signed out, so guards must leave
 * routing untouched on `undefined` instead of bouncing to sign-in.
 */
async function resolveRoutingSession(): Promise<
  AuthClientSession | null | undefined
> {
  // A cached success is authoritative enough for routing decisions; do not
  // stall navigation behind an in-flight revalidation. Null also covers
  // cached failures and confirmed sign-outs, which fall through to the await
  // below — a settled atom resolves there without a network stall.
  let session: AuthClientSession | null = getCachedAuthSession();
  if (session === null) {
    try {
      session = await getAuthSession();
    } catch {
      return undefined;
    }
  }

  // SSO-restricted users are scoped to their board subdomain; on the dashboard
  // they are treated as signed out exactly as the former middleware did.
  return session?.user.restrictedToOrganizationId != null ? null : session;
}

/**
 * Whether an auth page must stay reachable with a session.
 *
 * Password recovery is the exception to "signed-in visitors leave the auth
 * pages": it has to work on a shared device, where the browser may still hold
 * somebody else's session and the visitor cannot sign out to recover their own
 * account.
 */
export function isPasswordRecoveryPath(pathname: string): boolean {
  return PASSWORD_RESET_PATHS.has(normalizePathname(pathname));
}

/** Where a visitor who already has a session belongs. */
function signedInDestination(session: AuthClientSession): string {
  const defaultOrganizationId = getDefaultOrganizationId(session);

  return defaultOrganizationId ? `/${defaultOrganizationId}` : REGISTER_PATH;
}

/**
 * Where a signed-in visitor should go instead of the auth page they opened, or
 * `undefined` when they should stay.
 *
 * The one implementation of that decision, shared by the router guard (a
 * client-side navigation) and `AuthPageRedirect` (a cold load, which hydration
 * does not re-guard). Two things make "they have a session, so move them on"
 * wrong on its own:
 *
 *   - Board hosts serve `/sign-in` and `/sign-up` deliberately — they are the
 *     board's pages there — and the workspace paths this would send them to do
 *     not exist on that host: they resolve as board routes and 404.
 *   - An SSO-restricted session belongs to its board. `resolveRoutingSession`
 *     already treats one as signed out for routing, so the redirect must too.
 */
export function authPageRedirectHref(
  session: AuthClientSession
): string | undefined {
  if (!isAppSubdomainHost()) {
    return undefined;
  }

  if (session.user.restrictedToOrganizationId != null) {
    return undefined;
  }

  return signedInDestination(session);
}

/** Sends a visitor who already has a session away from an auth page. */
function redirectSignedInVisitorFromAuthPage(
  session: AuthClientSession,
  pathname: string
): void {
  if (isPasswordRecoveryPath(pathname)) {
    return;
  }

  const href = authPageRedirectHref(session);

  if (href === undefined) {
    return;
  }

  throw redirect({ href });
}

/**
 * The guard for the auth pages, which live outside the client-only dashboard
 * boundary so the server can render their forms (`routes/_auth.tsx`).
 *
 * One rule applies there: a visitor who already has a session is moved on.
 * Anonymous visitors render immediately — signing in needs no session, and
 * making these pages wait for one is what put a dashboard-shaped spinner in
 * front of the fastest possible paint.
 */
export async function authPageBeforeLoad({
  location,
}: {
  location: BeforeLoadLocation;
}): Promise<void> {
  // The document is server-rendered and shared: the server has no access to
  // the visitor's session (it would have to forward a cookie to the API), so
  // the decision belongs to the browser. `AuthPageRedirect` makes it once the
  // atom resolves — hydration reuses this hook's server answer rather than
  // re-running it, which is why the component exists.
  if (!hasWindow() || !isAppSubdomainHost()) {
    return;
  }

  const session = await resolveRoutingSession();

  if (session === null || session === undefined) {
    return;
  }

  redirectSignedInVisitorFromAuthPage(
    session,
    normalizePathname(location.pathname)
  );
}

/**
 * TanStack Router `beforeLoad` guard enforcing the dashboard auth redirects.
 * Mounted on `/_dashboard`, so every navigation into the app — including the
 * initial document load — resolves the session before any route renders.
 */
export async function dashboardAuthBeforeLoad({
  location,
}: {
  location: BeforeLoadLocation;
}): Promise<void> {
  if (!isAppSubdomainHost()) {
    return;
  }

  const session = await resolveRoutingSession();

  // A transport failure means the session is unknown, not signed-out. Leave
  // routing untouched: protected routes stay behind their gates and recover
  // once the atom revalidates.
  if (session === undefined) {
    return;
  }

  const effectiveSession = session;

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

  if (
    !hasOrganizations &&
    !(isAuthPath || isRegisterPath || isInvitationPath(pathname))
  ) {
    redirectToRegister(location);
  }

  if (isAuthPath) {
    redirectSignedInVisitorFromAuthPage(effectiveSession, pathname);
  }

  if (
    !defaultOrganizationId ||
    DASHBOARD_NON_ORG_PATHS.has(pathname) ||
    isInvitationPath(pathname)
  ) {
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

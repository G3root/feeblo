const DEFAULT_SESSION_COOKIE_NAME = "better-auth.session_token";
const SECURE_SESSION_COOKIE_NAME = `__Secure-${DEFAULT_SESSION_COOKIE_NAME}`;

/**
 * Returns the session cookie name better-auth actually sets.
 *
 * Better-auth applies the `__Secure-` prefix when `useSecureCookies` is
 * enabled, which defaults to `NODE_ENV === "production"`. `packages/auth` does
 * not override `useSecureCookies`, so deciding from `APP_URL` instead would
 * diverge from the cookie better-auth emits (e.g. an https APP_URL outside
 * production, or an http APP_URL inside production), silently breaking
 * authentication in those environments.
 *
 * If `packages/auth` ever overrides `useSecureCookies` or the cookie name,
 * this predicate must be updated in lockstep.
 */
export const getSessionCookieName = (): string => {
  const isProduction = process.env.NODE_ENV === "production";

  return isProduction ? SECURE_SESSION_COOKIE_NAME : DEFAULT_SESSION_COOKIE_NAME;
};

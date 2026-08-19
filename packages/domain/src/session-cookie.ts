const DEFAULT_SESSION_COOKIE_NAME = "better-auth.session_token";
const SECURE_SESSION_COOKIE_NAME = `__Secure-${DEFAULT_SESSION_COOKIE_NAME}`;

/** Pure resolver: no process.env access — callers inject the API URL. */
export const getSessionCookieNameForUrl = (
  apiUrl: string | undefined
): string => {
  const useSecurePrefix = apiUrl ? apiUrl.startsWith("https://") : false;
  return useSecurePrefix
    ? SECURE_SESSION_COOKIE_NAME
    : DEFAULT_SESSION_COOKIE_NAME;
};

/**
 * Returns the session cookie name better-auth actually sets.
 *
 * Better-auth applies the `__Secure-` prefix from its `secureCookiePrefix`
 * resolution: `useSecureCookies` when set, otherwise the base URL protocol,
 * falling back to `NODE_ENV === "production"` only when no base URL is
 * configured. `packages/auth` passes `baseURL: apiUrl` (a string) and does not
 * override `useSecureCookies`, so better-auth prefixes the cookie exactly when
 * the API base URL is https.
 *
 * If `packages/auth` ever overrides `useSecureCookies`, stops passing a string
 * base URL, or renames the cookie, this predicate must be updated in lockstep.
 */
/**
 * Legacy fallback that reads process.env directly. Prefer `getSessionCookieNameForUrl`
 * with an injected API_URL (e.g. via Effect Config) in server code. Kept for
 * backwards-compat with call sites that have not yet migrated to DI.
 */
export const getSessionCookieName = (): string => {
  const apiUrl =
    typeof process !== "undefined" ? process.env.API_URL : undefined;
  const nodeEnv =
    typeof process !== "undefined" ? process.env.NODE_ENV : undefined;
  if (apiUrl !== undefined) {
    return getSessionCookieNameForUrl(apiUrl);
  }
  // Fallback only when API_URL is absent (mirrors better-auth's second branch).
  return nodeEnv === "production"
    ? SECURE_SESSION_COOKIE_NAME
    : DEFAULT_SESSION_COOKIE_NAME;
};

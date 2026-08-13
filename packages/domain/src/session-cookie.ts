const DEFAULT_SESSION_COOKIE_NAME = "better-auth.session_token";
const SECURE_SESSION_COOKIE_NAME = `__Secure-${DEFAULT_SESSION_COOKIE_NAME}`;

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
export const getSessionCookieName = (): string => {
  const apiUrl = process.env.API_URL;
  const useSecurePrefix = apiUrl
    ? apiUrl.startsWith("https://")
    : process.env.NODE_ENV === "production";

  return useSecurePrefix
    ? SECURE_SESSION_COOKIE_NAME
    : DEFAULT_SESSION_COOKIE_NAME;
};

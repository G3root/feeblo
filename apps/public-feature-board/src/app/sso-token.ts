/**
 * Reads the SSO token from the URL fragment. The SDK puts it there (rather
 * than in the query string) so it is never sent to the server or leaked via
 * the Referer header. The route's `beforeLoad` reads it and strips it from
 * history before render.
 */
export const getSsoTokenFromHash = (hash: string): string | null => {
  if (!hash.startsWith("#")) {
    return null;
  }
  const params = new URLSearchParams(hash.slice(1));
  return params.get("ssoToken");
};

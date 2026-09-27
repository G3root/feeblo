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

/** Removes SSO token entries while preserving unrelated fragment content. */
export const removeSsoTokenFromHash = (hash: string): string => {
  if (!hash.startsWith("#")) {
    return hash;
  }

  const entries = hash
    .slice(1)
    .split("&")
    .filter((entry) => !new URLSearchParams(entry).has("ssoToken"));

  return entries.length > 0 ? `#${entries.join("&")}` : "";
};

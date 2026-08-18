/**
 * Parses the Slack OAuth callback request URL (a relative path such as
 * `/slack/oauth/callback?code=…&state=…`) into its query parameters.
 *
 * The server request framework exposes `request.url` as the relative path
 * only, so `new URL` needs a dummy base to parse the query string.
 */
/** Query parameters parsed from the OAuth callback URL. */
export interface OAuthCallbackQuery {
  readonly code: string | null;
  readonly error: string | null;
  readonly state: string | null;
}

export const parseSlackOAuthCallbackUrl = (url: string): OAuthCallbackQuery => {
  const parsed = new URL(url, "http://localhost");
  return {
    code: parsed.searchParams.get("code"),
    error: parsed.searchParams.get("error"),
    state: parsed.searchParams.get("state"),
  };
};

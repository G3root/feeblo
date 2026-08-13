import { describe, expect, it } from "vitest";
import { parseDiscordOAuthCallbackUrl } from "./oauth-callback";

describe("parseDiscordOAuthCallbackUrl", () => {
  it("parses code and state from the relative callback path", () => {
    const parsed = parseDiscordOAuthCallbackUrl(
      "/discord/oauth/callback?code=oauth-code-123&state=%7B%22connectionId%22%3A%22icn_1%22%7D"
    );
    expect(parsed.code).toBe("oauth-code-123");
    expect(parsed.state).toBe('{"connectionId":"icn_1"}');
    expect(parsed.error).toBeNull();
  });

  it("surfaces the Discord error parameter on denial", () => {
    const parsed = parseDiscordOAuthCallbackUrl(
      "/discord/oauth/callback?error=access_denied"
    );
    expect(parsed.error).toBe("access_denied");
    expect(parsed.code).toBeNull();
    expect(parsed.state).toBeNull();
  });

  it("handles a bare path without query parameters", () => {
    const parsed = parseDiscordOAuthCallbackUrl("/discord/oauth/callback");
    expect(parsed).toEqual({ code: null, error: null, state: null });
  });
});

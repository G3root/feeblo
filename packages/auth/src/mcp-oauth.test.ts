import { PUBLIC_API_MCP_PATH } from "@feeblo/domain/public-api/mcp";
import { describe, expect, it } from "vitest";

import {
  MCP_OAUTH_SCOPES,
  MCP_RESOURCE_PATH,
  mcpResourceUrl,
} from "./mcp-oauth";

/**
 * The auth server keeps its own copy of the MCP path so that importing the
 * Public API's module graph at startup is not required. These assertions are
 * what makes the copy safe: a rename in `@feeblo/domain` fails here instead of
 * minting tokens whose `aud` no route verifies.
 */
describe("mcp-oauth configuration", () => {
  it("mounts the resource at the path the MCP route serves", () => {
    expect(MCP_RESOURCE_PATH).toBe(PUBLIC_API_MCP_PATH);
  });

  it("builds the resource identifier from the API origin", () => {
    expect(mcpResourceUrl("https://api.feeblo.com")).toBe(
      "https://api.feeblo.com/mcp"
    );
    // A trailing slash on API_URL must not produce `//mcp`.
    expect(mcpResourceUrl("https://api.feeblo.com/")).toBe(
      "https://api.feeblo.com/mcp"
    );
  });

  it("advertises the OIDC scopes MCP clients request", () => {
    for (const scope of ["openid", "profile", "email", "offline_access"]) {
      expect(MCP_OAUTH_SCOPES).toContain(scope);
    }
  });
});

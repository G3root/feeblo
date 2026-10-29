import { PUBLIC_API_MCP_PATH } from "@feeblo/domain/public-api/mcp";
import { describe, expect, it } from "vitest";

import {
  MCP_OAUTH_SCOPES,
  MCP_RESOURCE_PATH,
  MCP_WORKSPACE_CLAIM,
  mcpResourceUrl,
  parseAccessTokenClaims,
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

/**
 * The workspace rule is the one the verifier must not soften: a token that
 * names no workspace cannot become a caller, and defaulting to the member's
 * active workspace would be a cross-tenant read. Testing the parse step
 * covers that guard without minting a JWT.
 */
describe("parseAccessTokenClaims", () => {
  const credential = {
    azp: "client_mcp_test",
    scope: "openid tags.read",
    sub: "user_mcp_test",
  };

  it("reads the subject, client, workspace, and granted scopes", () => {
    expect(
      parseAccessTokenClaims({
        ...credential,
        [MCP_WORKSPACE_CLAIM]: "org_workspace",
      })
    ).toEqual({
      _tag: "Parsed",
      clientId: "client_mcp_test",
      organizationId: "org_workspace",
      scopes: ["openid", "tags.read"],
      subject: "user_mcp_test",
    });
  });

  it("accepts client_id when the provider did not write azp", () => {
    const parsed = parseAccessTokenClaims({
      [MCP_WORKSPACE_CLAIM]: "org_workspace",
      client_id: "client_fallback",
      sub: "user_mcp_test",
    });
    expect(parsed._tag).toBe("Parsed");
    expect(parsed).toMatchObject({ clientId: "client_fallback" });
  });

  it("refuses a token with no workspace claim", () => {
    expect(parseAccessTokenClaims(credential)).toEqual({
      _tag: "MissingWorkspace",
    });
  });

  it("refuses an empty workspace claim rather than treating it as absent", () => {
    expect(
      parseAccessTokenClaims({ ...credential, [MCP_WORKSPACE_CLAIM]: "" })
    ).toEqual({ _tag: "MissingWorkspace" });
  });

  it("refuses a token with no subject", () => {
    expect(
      parseAccessTokenClaims({
        [MCP_WORKSPACE_CLAIM]: "org_workspace",
        azp: "client_mcp_test",
      })
    ).toEqual({ _tag: "MissingCredential" });
  });
});

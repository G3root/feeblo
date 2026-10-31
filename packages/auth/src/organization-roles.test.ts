import { describe, expect, it } from "vitest";

import { roleMayAuthorizeWorkspaceCredential } from "./organization-roles";

/**
 * An OAuth grant is a workspace-wide machine credential, so authorizing one
 * uses the same ACL statement that gates creating a workspace API key. These
 * cases pin the boundary the consent flow and the token check both rely on:
 * contribute and manage feedback, but do not mint credentials.
 */
describe("roleMayAuthorizeWorkspaceCredential", () => {
  it("allows the roles that may create a workspace API key", () => {
    expect(roleMayAuthorizeWorkspaceCredential("owner")).toBe(true);
    expect(roleMayAuthorizeWorkspaceCredential("admin")).toBe(true);
  });

  it("refuses the roles the API-key ACL refuses", () => {
    expect(roleMayAuthorizeWorkspaceCredential("manager")).toBe(false);
    expect(roleMayAuthorizeWorkspaceCredential("contributor")).toBe(false);
  });

  it("accepts a comma-separated role list when any entry qualifies", () => {
    expect(roleMayAuthorizeWorkspaceCredential("contributor,admin")).toBe(true);
    expect(roleMayAuthorizeWorkspaceCredential("contributor, manager")).toBe(
      false
    );
  });

  it("refuses a role that is not in the ACL", () => {
    expect(roleMayAuthorizeWorkspaceCredential("billing")).toBe(false);
  });
});

import { randomUUID } from "node:crypto";

export type TestUser = {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
};

/**
 * The subdomain a test workspace claims.
 *
 * Derived from the workspace name, which already carries a random suffix, so it
 * is unique per run and short enough for the address field. The register
 * wizard asks for it rather than deriving one, so the helper has to supply it.
 */
export function subdomainFor(workspaceName: string): string {
  return workspaceName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createTestUser(): TestUser {
  const id = randomUUID().slice(0, 12);

  return {
    name: `Test User ${id}`,
    email: `test-${id}@feeblo.dev`.toLowerCase(),
    password: "TestPassword123!",
    workspaceName: `E2E Workspace ${id}`,
  };
}

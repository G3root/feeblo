import { randomUUID } from "node:crypto";

export type TestUser = {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
};

export function createTestUser(): TestUser {
  const id = randomUUID().slice(0, 12);
  return {
    name: `Test User ${id}`,
    email: `test-${id}@feeblo.dev`.toLowerCase(),
    password: "TestPassword123!",
    workspaceName: `E2E Workspace ${id}`,
  };
}

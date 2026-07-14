export type TestUser = {
  name: string;
  email: string;
  password: string;
  workspaceName: string;
};

let counter = 0;

export function createTestUser(): TestUser {
  const id = `${Date.now()}-${++counter}`;
  return {
    name: `Test User ${id}`,
    email: `test-${id}@feeblo.dev`.toLowerCase(),
    password: "TestPassword123!",
    workspaceName: `E2E Workspace ${id}`,
  };
}

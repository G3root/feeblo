import { type APIRequestContext, expect } from "@playwright/test";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";

/**
 * Puts a workspace on a paid plan through the test-only `/__e2e/set-plan`
 * endpoint so entitlement-gated features (e.g. widget SSO) can be exercised
 * end-to-end without going through the Polar checkout flow.
 */
export async function setPlan(
  request: APIRequestContext,
  payload: {
    organizationId: string;
    plan: "starter" | "professional";
  }
) {
  const response = await request.post(`${apiURL}/__e2e/set-plan`, {
    data: payload,
  });

  expect(response.ok()).toBeTruthy();

  return (await response.json()) as { plan: "starter" | "professional" };
}

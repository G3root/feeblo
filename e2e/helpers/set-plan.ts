import { type APIRequestContext, expect } from "@playwright/test";

import { apiUrl } from "./urls";

/**
 * Sets a workspace's plan through the test-only `/__e2e/set-plan` endpoint,
 * so entitlement-gated features and the over-plan gate can be exercised
 * end-to-end without going through the Polar checkout flow. Passing `"free"`
 * removes the subscription, which is how a spec simulates a downgrade.
 */
export async function setPlan(
  request: APIRequestContext,
  payload: {
    organizationId: string;
    plan: "free" | "starter" | "professional";
  }
) {
  const response = await request.post(`${apiUrl()}/__e2e/set-plan`, {
    data: payload,
  });

  expect(response.ok()).toBeTruthy();

  // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
  return (await response.json()) as {
    plan: "free" | "starter" | "professional";
  };
}

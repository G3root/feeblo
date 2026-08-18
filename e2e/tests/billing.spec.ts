import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";

test.describe("billing", () => {
  test("shows a safe pending state after returning from checkout", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);

    await page.goto(
      `${owner.organizationUrl}/settings/billing?checkout_id=checkout_e2e`
    );

    await expect(
      page.getByRole("heading", { name: "Billing", exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Checkout completed — confirming your subscription", {
        exact: true,
      })
    ).toBeVisible();
    await expect(page.getByText("Free", { exact: true }).first()).toBeVisible();
  });
});

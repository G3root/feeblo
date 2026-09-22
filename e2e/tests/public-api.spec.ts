import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import { setPlan } from "../helpers/set-plan";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const apiKeyPattern = /^fbk_/;

/**
 * The first segment of the dashboard URL is the organization id, which the
 * Public API's plan gate and key list are scoped to.
 */
function organizationIdOf(organizationUrl: string): string {
  const segment = new URL(organizationUrl).pathname.split("/").find(Boolean);
  expect(segment).toBeDefined();
  if (segment === undefined) {
    throw new Error("Workspace URL did not contain an organization id");
  }
  return segment;
}

test.describe("public API keys", () => {
  test("a free workspace is told the feature needs a paid plan", async ({
    page,
  }) => {
    const workspace = await createAuthenticatedWorkspace(page);

    await page.goto(`${workspace.organizationUrl}/settings/developers`);

    await expect(
      page.getByRole("heading", { name: "Developers" })
    ).toBeVisible();
    await expect(
      page.getByText("The Public API requires the Starter plan or higher.")
    ).toBeVisible();
    // The plan gate is on the server; the UI does not offer a request it knows
    // will be refused.
    await expect(page.getByRole("button", { name: "New key" })).toBeDisabled();
  });

  test(
    "a paid workspace creates a key, uses it, and revokes it",
    { tag: "@critical" },
    async ({ page, request }) => {
      const workspace = await createAuthenticatedWorkspace(page);
      const organizationId = organizationIdOf(workspace.organizationUrl);
      await setPlan(request, { organizationId, plan: "starter" });

      await page.goto(`${workspace.organizationUrl}/settings/developers`);
      const newKeyButton = page.getByRole("button", { name: "New key" });
      await expect(newKeyButton).toBeEnabled();

      let apiKey = "";

      await test.step("create a key and read the one-time value", async () => {
        await newKeyButton.click();
        await page.getByLabel("Name").fill("Production sync");
        await page.getByRole("button", { name: "Create key" }).click();

        const oneTimePanel = page.getByRole("region", { name: "New API key" });
        await expect(oneTimePanel).toBeVisible();

        apiKey = (await oneTimePanel.locator("code").innerText()).trim();
        expect(apiKey).toMatch(apiKeyPattern);
      });

      await test.step("the key authenticates against /api/v1", async () => {
        // A missing post is answered with the documented envelope, which only
        // happens after the key, the plan, and the scope have all passed.
        const authorized = await request.get(
          `${apiURL}/api/v1/posts/pst_missing`,
          { headers: { "x-api-key": apiKey } }
        );

        expect(authorized.status()).toBe(404);
        expect(await authorized.json()).toMatchObject({ _tag: "NOT_FOUND" });

        const anonymous = await request.get(
          `${apiURL}/api/v1/posts/pst_missing`
        );
        expect(anonymous.status()).toBe(401);
        expect(await anonymous.json()).toMatchObject({
          _tag: "MISSING_API_KEY",
        });
      });

      await test.step("revoking the key stops it working immediately", async () => {
        await page.getByRole("button", { name: "Done" }).click();

        await page
          .getByRole("button", { name: "Actions for Production sync" })
          .click();
        await page.getByRole("menuitem", { name: "Revoke key" }).click();
        await page.getByRole("button", { name: "Revoke key" }).click();

        await expect(page.getByText("API key revoked")).toBeVisible();
        await expect(page.getByText("No API keys yet")).toBeVisible();

        const revoked = await request.get(
          `${apiURL}/api/v1/posts/pst_missing`,
          { headers: { "x-api-key": apiKey } }
        );
        expect(revoked.status()).toBe(401);
        expect(await revoked.json()).toMatchObject({
          _tag: "INVALID_API_KEY",
        });
      });
    }
  );
});

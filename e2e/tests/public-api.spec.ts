import { expect, test } from "../fixtures";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { setPlan } from "../helpers/set-plan";
import { apiUrl } from "../helpers/urls";

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
        // Capabilities, not an access level: no write scope is implied by
        // asking for a key, so the sheet has to be told which ones to include.
        await page.getByRole("checkbox", { name: "Manage posts" }).check();
        await page.getByRole("checkbox", { name: "Manage companies" }).check();
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
          `${apiUrl()}/api/v1/posts/pst_missing`,
          { headers: { "x-api-key": apiKey } }
        );

        expect(authorized.status()).toBe(404);
        expect(await authorized.json()).toMatchObject({ _tag: "NOT_FOUND" });

        const anonymous = await request.get(
          `${apiUrl()}/api/v1/posts/pst_missing`
        );
        expect(anonymous.status()).toBe(401);
        expect(await anonymous.json()).toMatchObject({
          _tag: "MISSING_API_KEY",
        });
      });

      await test.step("the posts capability reaches the post endpoints", async () => {
        // The workspace-wide list exists and needs no id, so it is the one
        // post read that can be exercised without a fixture.
        const listed = await request.get(`${apiUrl()}/api/v1/posts`, {
          headers: { "x-api-key": apiKey },
        });
        expect(listed.status()).toBe(200);
        expect(Array.isArray((await listed.json()).data)).toBe(true);

        // A retrieve that names no post is the documented invalid request,
        // which only happens after the key, plan, and scope have passed.
        const retrieve = await request.get(
          `${apiUrl()}/api/v1/posts/retrieve`,
          {
            headers: { "x-api-key": apiKey },
          }
        );
        expect(retrieve.status()).toBe(400);
        expect(await retrieve.json()).toMatchObject({
          _tag: "INVALID_REQUEST",
        });

        // The scope is checked before the post is looked up, so `404` proves
        // the key holds `posts.delete`; without it this would be `403`.
        const missing = await request.delete(
          `${apiUrl()}/api/v1/posts/pst_missing`,
          { headers: { "x-api-key": apiKey } }
        );

        expect(missing.status()).toBe(404);
        expect(await missing.json()).toMatchObject({ _tag: "NOT_FOUND" });
      });

      await test.step("the CRM grant reaches the company endpoints", async () => {
        const created = await request.post(`${apiUrl()}/api/v1/companies`, {
          headers: { "x-api-key": apiKey },
          data: { name: "Acme", externalId: "e2e-crm-1" },
        });

        expect(created.status()).toBe(201);
        expect(await created.json()).toMatchObject({
          name: "Acme",
          externalId: "e2e-crm-1",
          source: "API",
        });

        // The list is the assertion rather than a read by id: the id is minted
        // by the server, and this keeps the spec free of a cast to reach it.
        const listed = await request.get(`${apiUrl()}/api/v1/companies`, {
          headers: { "x-api-key": apiKey },
        });
        expect(listed.status()).toBe(200);
        expect(await listed.json()).toMatchObject({
          data: [{ name: "Acme", externalId: "e2e-crm-1", source: "API" }],
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
          `${apiUrl()}/api/v1/posts/pst_missing`,
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

import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import { setPlan } from "../helpers/set-plan";
import { copyWorkspaceJwtSecret } from "../helpers/widget-sso";

function widgetSettingsUrl(organizationUrl: string): string {
  return `${organizationUrl}/settings/widget`;
}

function organizationIdFrom(organizationUrl: string): string {
  return new URL(organizationUrl).pathname.slice(1);
}

test.describe("widget settings", () => {
  test("builds the widget and carries the settings into the snippets", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const organizationId = organizationIdFrom(owner.organizationUrl);

    await page.goto(widgetSettingsUrl(owner.organizationUrl));

    // The preview is the shipped widget document, live in its iframe.
    await expect(
      page.getByRole("heading", { name: "Widget", exact: true })
    ).toBeVisible();
    const widgetFrame = page.frameLocator('iframe[title="Widget preview"]');
    await expect(widgetFrame.getByText("Give us feedback")).toBeVisible({
      timeout: 20_000,
    });

    // The preview launcher drives the widget's own open/close state.
    const panel = page
      .locator('iframe[title="Widget preview"]')
      .locator("xpath=..");
    await page
      .getByRole("button", { name: "Close the widget preview" })
      .click();
    await expect(panel).toHaveAttribute("aria-hidden", "true");
    await page.getByRole("button", { name: "Open the widget preview" }).click();
    await expect(widgetFrame.getByText("Give us feedback")).toBeVisible();

    // Hub navigation works inside the preview.
    await widgetFrame.getByRole("link", { name: "Updates" }).click();
    await expect(
      widgetFrame.getByText("Product updates", { exact: true })
    ).toBeVisible();

    // Reordering the module stack changes what the widget opens on: the
    // first module becomes Updates, so the remounted preview lands there.
    await page
      .getByRole("button", { name: "Reorder Feedback" })
      .dragTo(page.getByRole("button", { name: "Reorder Updates" }));
    await expect(
      widgetFrame.getByText("Product updates", { exact: true })
    ).toBeVisible({ timeout: 20_000 });

    // Hiding a module drops the widget to the single-module mode...
    await page.getByRole("switch", { name: "Hide Feedback module" }).click();
    await expect(
      page.getByText("Updates widget", { exact: true })
    ).toBeVisible();

    // ...and the launcher and theme choices land in the script tag.
    await page.getByRole("tab", { name: "Vanilla" }).click();
    await page.getByRole("button", { name: "Left" }).click();
    await page.getByRole("button", { name: "Dark" }).click();

    // Snippets are highlighted with rangi, the editor's highlighter.
    await expect(
      page.locator("pre code span[class^='shj-']").first()
    ).toBeVisible();

    await expect(
      page.getByText('data-feeblo-mode="updates"', { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText('data-feeblo-placement="bottom-left"', { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText('data-feeblo-theme="dark"', { exact: false })
    ).toBeVisible();

    // The prompt button hands the same settings to a coding agent.
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"], {
        origin: new URL(owner.organizationUrl).origin,
      });
    await page
      .getByRole("button", { name: "Copy installation as prompt" })
      .click();
    await expect(page.getByText("Installation prompt copied")).toBeVisible();
    const prompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(prompt).toContain(`Organization ID: ${organizationId}`);

    // React swaps the snippet pair for the provider.
    await page.getByRole("tab", { name: "React" }).click();
    await expect(
      page.getByText("pnpm add @feeblo/sdk-react @feeblo/sdk")
    ).toBeVisible();
    await expect(
      page.getByText('import { FeebloProvider } from "@feeblo/sdk-react";')
    ).toBeVisible();
  });

  test("shows the signing secret and the identity steps", async ({ page }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const organizationId = organizationIdFrom(owner.organizationUrl);

    // Widget SSO is a paid capability: put the workspace on Starter first.
    await setPlan(page.request, { organizationId, plan: "starter" });
    await page.goto(widgetSettingsUrl(owner.organizationUrl));

    await expect(
      page.getByText("Identify your users", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Generate a secret in Security", { exact: false })
    ).toBeVisible();

    // Generating goes through Security today; copying happens on this page.
    const secret = await copyWorkspaceJwtSecret(page, organizationId);

    await page.goto(widgetSettingsUrl(owner.organizationUrl));
    const copySecret = page.getByRole("button", { name: "Copy secret" });
    await expect(copySecret).toBeVisible();
    await copySecret.click();
    await expect(
      page.getByText("Secret copied", { exact: false })
    ).toBeVisible();
    expect(secret).toHaveLength(64);

    // The signing example binds the token to this workspace.
    await expect(
      page.getByText(`setAudience("${organizationId}")`, { exact: false })
    ).toBeVisible();

    // Step 3 follows the install tab chosen in Installation.
    await expect(
      page.getByText("Feeblo.identify({", { exact: false })
    ).toBeVisible();
    await page.getByRole("tab", { name: "React" }).click();
    await expect(
      page.getByText(
        "user={{ id: user.id, email: user.email, name: user.name, token }}",
        { exact: false }
      )
    ).toBeVisible();
  });
});

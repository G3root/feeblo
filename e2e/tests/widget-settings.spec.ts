import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";

function widgetSettingsUrl(organizationUrl: string): string {
  return `${organizationUrl}/settings/widget`;
}

test.describe("widget settings", () => {
  test("builds the widget and carries the settings into the snippets", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const organizationId = new URL(owner.organizationUrl).pathname.slice(1);

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
    await page.getByRole("tab", { name: "Script" }).click();
    await page.getByRole("button", { name: "Left" }).click();
    await page.getByRole("button", { name: "Dark" }).click();
    await expect(
      page.getByText('data-feeblo-mode="updates"', { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText('data-feeblo-placement="bottom-left"', { exact: false })
    ).toBeVisible();
    await expect(
      page.getByText('data-feeblo-theme="dark"', { exact: false })
    ).toBeVisible();

    // The agent prompt carries the same workspace.
    await page.getByRole("tab", { name: "Agent" }).click();
    await expect(
      page.getByText(`Organization ID: ${organizationId}`, { exact: false })
    ).toBeVisible();
  });
});

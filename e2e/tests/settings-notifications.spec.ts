import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";

/** `/<organizationId>` plus a settings suffix, on whatever host the app serves. */
const settingsPath = (organizationUrl: string, suffix: string) =>
  `${new URL(organizationUrl).pathname.replace(/\/$/, "")}${suffix}`;

/**
 * The page the "unsubscribe" link in submission-notification email points at.
 * The email itself coalesces submissions behind a five-minute quiet window, so
 * this exercises the destination and the preference RPC rather than waiting
 * for a send.
 */
test("the submission notification preference toggles and persists", async ({
  page,
}) => {
  const owner = await createAuthenticatedWorkspace(page);

  await page.goto(
    settingsPath(owner.organizationUrl, "/settings/notifications")
  );
  await expect(
    page.getByRole("heading", { name: "Notifications" })
  ).toBeVisible();
  await expect(page.getByRole("switch")).not.toBeChecked();

  await page.getByRole("switch").click();
  await expect(
    page.getByText("Submission emails turned on", { exact: true })
  ).toBeVisible();

  // The preference is server state, not component state.
  await page.reload();
  await expect(page.getByRole("switch")).toBeChecked();

  await page.getByRole("switch").click();
  await expect(
    page.getByText("Submission emails turned off", { exact: true })
  ).toBeVisible();

  await page.reload();
  await expect(page.getByRole("switch")).not.toBeChecked();
});

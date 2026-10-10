import { expect, test } from "../fixtures";
import { createAuthenticatedWorkspace } from "../helpers/auth";

/** `/<organizationId>` plus a settings suffix, on whatever host the app serves. */
const settingsPath = (organizationUrl: string, suffix: string) =>
  `${new URL(organizationUrl).pathname.replace(/\/$/, "")}${suffix}`;

/**
 * The member preference page, and the body destination of the unsubscribe
 * link in notification email. The email itself coalesces behind a quiet
 * window, so this exercises the page and the preference RPC rather than
 * waiting for a send.
 */
test("notification preferences toggle and persist", async ({ page }) => {
  const owner = await createAuthenticatedWorkspace(page);

  await page.goto(
    settingsPath(owner.organizationUrl, "/settings/notifications")
  );
  await expect(
    page.getByRole("heading", { name: "Notifications" })
  ).toBeVisible();

  const pause = page.getByRole("switch", {
    name: "Pause all notification emails",
  });
  const newFeedback = page.getByRole("switch", { name: "New feedback" });
  const statusChanges = page.getByRole("switch", {
    name: "Post status changes",
  });

  // Every category is on by default and the workspace pause is off.
  await expect(pause).not.toBeChecked();
  await expect(newFeedback).toBeChecked();
  await expect(statusChanges).toBeChecked();

  // A category toggles independently, and the write is server state rather
  // than component state.
  await newFeedback.click();
  await expect(newFeedback).not.toBeChecked();
  await page.reload();
  await expect(
    page.getByRole("switch", { name: "New feedback" })
  ).not.toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Post status changes" })
  ).toBeChecked();

  // The changelog tab holds its own toggle.
  await page.getByRole("tab", { name: "Changelog" }).click();
  const changelog = page.getByRole("switch", {
    name: "Changelog published",
  });
  await expect(changelog).toBeChecked();

  // The workspace pause disables the categories but keeps their state.
  await pause.click();
  await expect(changelog).toBeDisabled();
  await page.reload();
  await page.getByRole("tab", { name: "Changelog" }).click();
  await expect(
    page.getByRole("switch", { name: "Pause all notification emails" })
  ).toBeChecked();
  await expect(
    page.getByRole("switch", { name: "Changelog published" })
  ).toBeDisabled();

  // Turning the pause back off restores the category choices.
  await page
    .getByRole("switch", { name: "Pause all notification emails" })
    .click();
  await expect(
    page.getByRole("switch", { name: "Changelog published" })
  ).toBeChecked();
});

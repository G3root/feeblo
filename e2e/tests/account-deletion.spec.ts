import { expect, type Page, test } from "@playwright/test";

import {
  createAuthenticatedWorkspace,
  signUpProgrammatically,
} from "../helpers/auth";
import {
  invitationIdFromEmail,
  waitForTestEmail,
} from "../helpers/test-mailbox";
import { createTestUser } from "../helpers/test-users";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const appOrigin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101")
  .origin;

/** `/<organizationId>` plus a settings suffix, on whatever host the app serves. */
const settingsPath = (organizationUrl: string, suffix: string) =>
  `${new URL(organizationUrl).pathname.replace(/\/$/, "")}${suffix}`;

/**
 * Opens the profile Danger Zone, fills in the password, and confirms deletion.
 * Resolves with the dialog so a test can assert on a refusal inside it.
 */
async function submitDeleteAccount(
  page: Page,
  organizationUrl: string,
  password: string
) {
  await page.goto(settingsPath(organizationUrl, "/settings/profile"));
  await page.getByRole("button", { name: "Delete account" }).click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Password", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Delete account" }).click();
  return dialog;
}

test.describe("account deletion", () => {
  test("a sole owner deletes the account and its workspace together", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);

    await submitDeleteAccount(page, owner.organizationUrl, owner.password);

    // The account is gone, so the dashboard has no session to return to.
    await page.waitForURL(/\/sign-up/);
    const signIn = await page
      .context()
      .request.post(`${apiURL}/api/auth/sign-in/email`, {
        data: { email: owner.email, password: owner.password },
        headers: { Origin: appOrigin },
      });
    expect(signIn.ok()).toBeFalsy();
  });

  test("an owner with teammates is refused until the workspace is handled", async ({
    browser,
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const teammate = createTestUser();
    const teammateContext = await browser.newContext();

    try {
      const teammatePage = await teammateContext.newPage();
      await signUpProgrammatically(teammatePage, teammate);

      // Invite the teammate and accept for them: this test is about deletion,
      // and the invitation UI has its own spec.
      await page.goto(settingsPath(owner.organizationUrl, "/settings/members"));
      const form = page.locator("form").filter({
        has: page.getByRole("textbox", { name: "Invite email" }),
      });
      await form
        .getByRole("textbox", { name: "Invite email" })
        .fill(teammate.email);
      await form.getByRole("button", { name: "Invite" }).click();
      await expect(
        page.getByText("Invitation sent", { exact: true })
      ).toBeVisible();
      const email = await waitForTestEmail(
        page.context().request,
        teammate.email
      );
      const accepted = await teammateContext.request.post(
        `${apiURL}/api/auth/organization/accept-invitation`,
        {
          data: { invitationId: invitationIdFromEmail(email) },
          headers: { Origin: appOrigin },
        }
      );
      expect(accepted.ok()).toBeTruthy();

      const dialog = await submitDeleteAccount(
        page,
        owner.organizationUrl,
        owner.password
      );

      await expect(
        dialog.getByText("still has other members", { exact: false })
      ).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Open Members settings" })
      ).toBeVisible();
      // The session survives the refusal.
      await expect(page).toHaveURL(/\/settings\/profile$/);
    } finally {
      await teammateContext.close();
    }
  });

  test("an owner deletes the workspace from workspace settings", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);

    await page.goto(settingsPath(owner.organizationUrl, "/settings/workspace"));
    await page.getByRole("button", { name: "Delete workspace" }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.getByLabel(/to confirm/).fill(owner.workspaceName);
    await dialog.getByRole("button", { name: "Delete workspace" }).click();

    // The last workspace is gone, so the guard asks for a new one.
    await page.waitForURL(/\/register/);
  });
});

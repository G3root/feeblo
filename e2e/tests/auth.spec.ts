import { expect, test } from "@playwright/test";

import {
  createAuthenticatedWorkspace,
  logIn,
  logOut,
  signUpAndCreateWorkspace,
} from "../helpers/auth";
import {
  verificationCodeFromEmail,
  waitForPasswordResetEmail,
} from "../helpers/test-mailbox";
import { createTestUser } from "../helpers/test-users";
import { ForgotPasswordPage } from "../page-objects/ForgotPasswordPage";
import { ResetPasswordPage } from "../page-objects/ResetPasswordPage";

const RESET_PASSWORD_URL = /\/reset-password/;
const SIGN_IN_URL = /\/sign-in/;

test.describe("authentication", () => {
  test.beforeEach(({ page }) => {
    page.on("console", (message) => {
      if (message.type() === "error") {
        console.error(`[browser console] ${message.text()}`);
      }
    });
    page.on("pageerror", (error) => {
      console.error(`[browser pageerror] ${error.message}`);
    });
  });

  test(
    "user can sign up and create a workspace",
    { tag: "@critical" },
    async ({ page }) => {
      const user = createTestUser();
      const { organizationUrl } = await signUpAndCreateWorkspace(page, user);

      await expect(page).toHaveURL(organizationUrl);
      await expect(
        page.getByRole("button", { name: user.email })
      ).toBeVisible();
    }
  );

  test(
    "user can sign in after signing out",
    { tag: "@critical" },
    async ({ page }) => {
      const user = createTestUser();
      const { organizationUrl } = await signUpAndCreateWorkspace(page, user);

      await logOut(page, user.email);
      await logIn(page, user);

      await expect(page).toHaveURL(organizationUrl);
      await expect(
        page.getByRole("button", { name: user.email })
      ).toBeVisible();
    }
  );

  test(
    "signed-in user can open the forgot password page",
    { tag: "@critical" },
    async ({ page }) => {
      const user = createTestUser();
      await createAuthenticatedWorkspace(page, user);

      await page.goto("/forgot-password");

      await expect(
        page.getByRole("button", { name: "Send reset code", exact: true })
      ).toBeVisible();
    }
  );

  test(
    "user can reset their password through the forgot password flow",
    { tag: "@critical" },
    async ({ page }) => {
      const user = createTestUser();
      const newPassword = "NewPassword456!";
      await createAuthenticatedWorkspace(page, user);
      await page.context().clearCookies();

      const forgotPasswordPage = new ForgotPasswordPage(page);
      await forgotPasswordPage.goto();
      await forgotPasswordPage.requestReset(user.email);

      await expect(page).toHaveURL(RESET_PASSWORD_URL);

      const email = await waitForPasswordResetEmail(page.request, user.email);
      const resetPasswordPage = new ResetPasswordPage(page);
      await resetPasswordPage.submitOtp(verificationCodeFromEmail(email));
      await resetPasswordPage.resetPassword(newPassword);

      await expect(page).toHaveURL(SIGN_IN_URL);

      await logIn(page, { ...user, password: newPassword });
      await expect(
        page.getByRole("button", { name: user.email })
      ).toBeVisible();
    }
  );
});

import { expect, test } from "@playwright/test";

import {
  createAuthenticatedWorkspace,
  logIn,
  logOut,
  signUpAndCreateWorkspace,
  signUpProgrammatically,
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

// ---------------------------------------------------------------------------
// Client-side auth redirects.
//
// The dashboard SPA resolves the session in its root route guard and enforces
// the sign-in, registration, and workspace-canonicalization redirects that
// Astro middleware used to perform.
// ---------------------------------------------------------------------------

test.describe("dashboard auth redirects", () => {
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
    "signed-out visitor is redirected to sign-in from a protected route",
    { tag: "@critical" },
    async ({ page }) => {
      await page.goto("/org_bogus/board");

      await expect(page).toHaveURL(/\/sign-in/);
      // The deep link is preserved for the post-login redirect.
      await expect(page).toHaveURL(/redirectTo=%2Forg_bogus%2Fboard/);
      await expect(
        page.getByRole("button", { name: "Login", exact: true })
      ).toBeVisible();
    }
  );

  test("signed-out visitor is redirected from register to sign-in", async ({
    page,
  }) => {
    await page.goto("/register");

    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page).toHaveURL(/redirectTo=%2Fregister/);
  });

  test(
    "signed-in user is redirected from sign-in to their workspace",
    { tag: "@critical" },
    async ({ page }) => {
      const user = createTestUser();
      const { organizationUrl } = await createAuthenticatedWorkspace(
        page,
        user
      );

      await page.goto("/sign-in");

      await expect(page).toHaveURL(organizationUrl);
    }
  );

  test("paths outside a workspace are canonicalized into it", async ({
    page,
  }) => {
    const user = createTestUser();
    const { organizationUrl } = await createAuthenticatedWorkspace(page, user);
    expect(organizationUrl).toMatch(/\/org_/);

    await page.goto("/settings");

    await expect(page).toHaveURL(/\/org_[^/]+$/);
  });

  test("a wrong workspace prefix is canonicalized to the member workspace", async ({
    page,
  }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    await page.goto("/org_bogus/settings");

    await expect(page).toHaveURL(/\/org_(?!bogus)[^/]+\/settings/);
  });

  test(
    "freshly authenticated user without a workspace lands on registration",
    { tag: "@critical" },
    async ({ page }) => {
      const user = createTestUser();
      await signUpProgrammatically(page, user);

      // A full document load makes the root guard resolve the brand-new
      // session; the authed-without-organization rule must route to
      // registration rather than bouncing back to sign-in.
      await page.goto("/");

      await expect(page).toHaveURL(/\/register/);
      await expect(
        page.getByRole("button", { name: "Create Workspace" })
      ).toBeVisible();
    }
  );
});

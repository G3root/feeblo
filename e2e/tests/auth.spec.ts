import { expect, test } from "@playwright/test";
import { logIn, logOut, signUpAndCreateWorkspace } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

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

});

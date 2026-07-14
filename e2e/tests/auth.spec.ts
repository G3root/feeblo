import { test, expect } from "@playwright/test";
import { logIn, logOut, signUpAndCreateWorkspace } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

test.describe.configure({ mode: "serial" });

test.describe("authentication", () => {
  test("user can sign up and create a workspace", async ({ page }) => {
    const user = createTestUser();
    const { organizationUrl } = await signUpAndCreateWorkspace(page, user);

    await expect(page).toHaveURL(organizationUrl);
    await expect(page.getByRole("button", { name: user.email })).toBeVisible();
  });

  test("user can sign in after signing out", async ({ page }) => {
    const user = createTestUser();
    const { organizationUrl } = await signUpAndCreateWorkspace(page, user);

    await logOut(page, user.email);
    await logIn(page, user);

    await page.waitForURL(organizationUrl);
    await expect(page.getByRole("button", { name: user.email })).toBeVisible();
  });
});

import type { Page } from "@playwright/test";
import { LoginPage } from "../page-objects/LoginPage";
import { RegisterPage } from "../page-objects/RegisterPage";
import { SignUpPage } from "../page-objects/SignUpPage";
import { createTestUser, type TestUser } from "./test-users";

export type AuthenticatedUser = TestUser & {
  organizationUrl: string;
};

export async function signUpAndCreateWorkspace(
  page: Page,
  user: TestUser = createTestUser()
): Promise<AuthenticatedUser> {
  const signUpPage = new SignUpPage(page);
  await signUpPage.goto();
  await signUpPage.signUp(user.name, user.email, user.password);

  // The sign-up flow lands on a placeholder route; navigate to the workspace
  // registration page so we can create the first organization.
  const registerPage = new RegisterPage(page);
  await registerPage.goto();

  // Submit the workspace form and wait for the org dashboard to load.
  await Promise.all([
    page.waitForURL(/\/org_/),
    registerPage.createWorkspace(user.workspaceName),
  ]);
  const organizationUrl = page.url();

  return { ...user, organizationUrl };
}

export async function logOut(page: Page, userEmail: string) {
  // Open the user menu in the sidebar and click log out.
  await page.getByRole("button", { name: userEmail }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL("/sign-in");
}

export async function logIn(page: Page, user: TestUser) {
  const loginPage = new LoginPage(page);
  await loginPage.goto();
  await loginPage.login(user.email, user.password);
}

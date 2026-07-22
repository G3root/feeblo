import { expect, type Page } from "@playwright/test";
import { LoginPage } from "../page-objects/LoginPage";
import { RegisterPage } from "../page-objects/RegisterPage";
import { SignUpPage } from "../page-objects/SignUpPage";
import {
  verificationCodeFromEmail,
  waitForVerificationEmail,
} from "./test-mailbox";
import { createTestUser, type TestUser } from "./test-users";

export type AuthenticatedUser = TestUser & {
  organizationUrl: string;
};

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";

export async function signUpProgrammatically(page: Page, user: TestUser) {
  const response = await page.context().request.post(
    `${apiURL}/api/auth/sign-up/email`,
    {
      data: {
        name: user.name,
        email: user.email,
        password: user.password,
      },
    }
  );

  expect(response.ok()).toBeTruthy();

  const email = await waitForVerificationEmail(page.request, user.email);
  const verificationResponse = await page.context().request.post(
    `${apiURL}/api/auth/email-otp/verify-email`,
    {
      data: {
        email: user.email,
        otp: verificationCodeFromEmail(email),
      },
    }
  );
  expect(verificationResponse.ok()).toBeTruthy();
}

async function verifyEmailThroughSignUpFlow(page: Page, user: TestUser) {
  await expect(page).toHaveURL(/\/email-verify/);
  await expect(
    page.getByRole("heading", { name: "Enter verification code" })
  ).toBeVisible();

  const email = await waitForVerificationEmail(page.request, user.email);
  await page.locator("#otp").fill(verificationCodeFromEmail(email));
  await page.getByRole("button", { name: "Verify", exact: true }).click();
  await expect(page).not.toHaveURL(/\/email-verify/);
}

export async function signUpAndCreateWorkspace(
  page: Page,
  user: TestUser = createTestUser()
): Promise<AuthenticatedUser> {
  const signUpPage = new SignUpPage(page);
  await signUpPage.goto();
  await signUpPage.signUp(user.name, user.email, user.password);
  await verifyEmailThroughSignUpFlow(page, user);

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

export async function createAuthenticatedWorkspace(
  page: Page,
  user: TestUser = createTestUser()
): Promise<AuthenticatedUser> {
  await signUpProgrammatically(page, user);

  const registerPage = new RegisterPage(page);
  await registerPage.goto();

  await Promise.all([
    page.waitForURL(/\/org_/),
    registerPage.createWorkspace(user.workspaceName),
  ]);

  return { ...user, organizationUrl: page.url() };
}

export async function logOut(page: Page, userEmail: string) {
  // Open the user menu in the sidebar and click log out.
  await page.getByRole("button", { name: userEmail }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.waitForURL("/sign-in");
  await expect(
    page.getByRole("button", { name: "Login", exact: true })
  ).toBeVisible();
}

export async function logIn(page: Page, user: TestUser) {
  const loginPage = new LoginPage(page);
  await expect(loginPage.submitButton).toBeVisible();
  await Promise.all([
    page.waitForURL(/\/org_/),
    loginPage.login(user.email, user.password),
  ]);
}

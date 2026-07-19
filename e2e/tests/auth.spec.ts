import { expect, test } from "@playwright/test";
import { logIn, logOut, signUpAndCreateWorkspace } from "../helpers/auth";
import {
  verificationCodeFromEmail,
  waitForVerificationEmail,
} from "../helpers/test-mailbox";
import { createTestUser } from "../helpers/test-users";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const appOrigin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101")
  .origin;

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

  test("user can verify their email with the emailed code", async ({
    page,
  }) => {
    const user = createTestUser();
    const { organizationUrl } = await signUpAndCreateWorkspace(page, user);
    await logOut(page, user.email);

    const verificationStateResponse = await page.request.post(
      `${apiURL}/api/auth/verification-otp`,
      {
        data: { email: user.email, type: "email-verification" },
      }
    );
    expect(verificationStateResponse).toBeOK();

    const sendCodeResponse = await page.request.post(
      `${apiURL}/api/auth/email-otp/send-verification-otp`,
      {
        data: { email: user.email, type: "email-verification" },
        headers: { Origin: appOrigin },
      }
    );
    expect(sendCodeResponse).toBeOK();

    const email = await waitForVerificationEmail(page.request, user.email);
    const code = verificationCodeFromEmail(email);

    await page.goto("/email-verify");
    await expect(
      page.getByRole("heading", { name: "Enter verification code" })
    ).toBeVisible();
    await page.getByRole("textbox").fill(code);
    await page.getByRole("button", { name: "Verify", exact: true }).click();

    await expect(page).toHaveURL(organizationUrl);
    await expect(page.getByRole("button", { name: user.email })).toBeVisible();
  });
});

import { type Locator, type Page, expect } from "@playwright/test";

export class ResetPasswordPage {
  readonly page: Page;
  readonly otpInput: Locator;
  readonly otpSubmitButton: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly passwordSubmitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.otpInput = page.locator("#otp");
    this.otpSubmitButton = page.getByRole("button", {
      name: "Continue",
      exact: true,
    });
    this.passwordInput = page.getByLabel("New Password", { exact: true });
    this.confirmPasswordInput = page.getByLabel("Confirm Password", {
      exact: true,
    });
    this.passwordSubmitButton = page.getByRole("button", {
      name: "Update password",
      exact: true,
    });
  }

  async submitOtp(otp: string) {
    await this.otpInput.fill(otp);
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/email-otp/check-verification-otp") &&
        response.request().method() === "POST"
    );
    await this.otpSubmitButton.click();
    await responsePromise;
    await expect(this.passwordSubmitButton).toBeVisible();
  }

  async resetPassword(password: string) {
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(password);
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/email-otp/reset-password") &&
        response.request().method() === "POST"
    );
    await this.passwordSubmitButton.click();
    await responsePromise;
  }
}

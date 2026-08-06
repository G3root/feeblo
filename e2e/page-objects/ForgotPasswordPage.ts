import { type Locator, type Page, expect } from "@playwright/test";

export class ForgotPasswordPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.getByRole("textbox", { name: "Email" });
    this.submitButton = page.getByRole("button", {
      name: "Send reset code",
      exact: true,
    });
  }

  async goto() {
    await this.page.goto("/forgot-password");
    await expect(this.submitButton).toBeVisible();
  }

  async requestReset(email: string) {
    await this.emailInput.fill(email);
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response
          .url()
          .includes("/api/auth/email-otp/request-password-reset") &&
        response.request().method() === "POST"
    );
    await this.submitButton.click();
    await responsePromise;
  }
}

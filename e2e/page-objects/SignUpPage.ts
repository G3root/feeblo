import { type Locator, type Page, expect } from "@playwright/test";

export class SignUpPage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly confirmPasswordInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.getByRole("textbox", { name: "Full Name" });
    this.emailInput = page.getByRole("textbox", { name: "Email" });
    this.passwordInput = page.getByLabel("Password", { exact: true });
    this.confirmPasswordInput = page.getByLabel("Confirm Password", {
      exact: true,
    });
    this.submitButton = page.getByRole("button", { name: "Sign up" });
  }

  async goto() {
    await this.page.goto("/sign-up");
    await expect(this.submitButton).toBeVisible();
  }

  async signUp(name: string, email: string, password: string) {
    await this.nameInput.fill(name);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmPasswordInput.fill(password);
    const responsePromise = this.page.waitForResponse(
      (response) =>
        response.url().includes("/api/auth/sign-up/email") &&
        response.request().method() === "POST"
    );
    await this.submitButton.click();
    await responsePromise;
  }
}

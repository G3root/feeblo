import { type Locator, type Page, expect } from "@playwright/test";

export class RegisterPage {
  readonly page: Page;
  readonly workspaceNameInput: Locator;
  readonly submitButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.workspaceNameInput = page.getByRole("textbox", {
      name: "Workspace Name",
    });
    this.submitButton = page.getByRole("button", { name: "Create Workspace" });
  }

  async goto() {
    await this.page.goto("/register");
    await expect(this.submitButton).toBeVisible();
  }

  async createWorkspace(name: string) {
    await this.workspaceNameInput.fill(name);
    await this.submitButton.click();
  }
}

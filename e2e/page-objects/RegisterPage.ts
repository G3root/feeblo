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

  /**
   * Closes the welcome tour if it opened.
   *
   * A first workspace lands on the dashboard with the tour up, and it is
   * modal, so every spec that wants to click on the dashboard has to get past
   * it. The tour appears once the workspace's site row has resolved — after
   * the URL changes — so this waits briefly and treats a tour that never
   * arrives (a second workspace, which does not get one) as nothing to do.
   */
  async dismissWelcomeTour() {
    const skip = this.page.getByRole("button", { name: "Skip", exact: true });

    const opened = await skip
      .waitFor({ state: "visible", timeout: 5_000 })
      .then(
        () => true,
        () => false
      );

    if (opened) {
      await skip.click();
      await expect(skip).toBeHidden();
    }
  }
}

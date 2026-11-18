import { type Locator, type Page, expect } from "@playwright/test";

/**
 * The register wizard.
 *
 * Four steps now, so "create a workspace" is a walk rather than a click. Every
 * helper that needs a workspace goes through this class, which is why the walk
 * lives here once instead of in each spec.
 */
export class RegisterPage {
  readonly page: Page;
  readonly workspaceNameInput: Locator;
  readonly subdomainInput: Locator;
  readonly continueButton: Locator;
  readonly createButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.workspaceNameInput = page.getByRole("textbox", {
      name: "Workspace name",
    });
    this.subdomainInput = page.getByRole("textbox", { name: "Board address" });
    this.continueButton = page.getByRole("button", { name: "Continue" });
    this.createButton = page.getByRole("button", {
      name: "Create workspace",
    });
  }

  async goto() {
    await this.page.goto("/register");
    await expect(this.workspaceNameInput).toBeVisible();
  }

  /**
   * Fills every step and submits.
   *
   * The board and team steps keep their defaults: the boards arrive selected
   * and the invitations are optional, so walking past them is what a reader
   * who wants the standard workspace does. The address is asserted rather than
   * assumed, because a test that waits on the check reports "taken" as a
   * message instead of timing out on a disabled button.
   */
  async createWorkspace(name: string, subdomain: string) {
    await this.workspaceNameInput.fill(name);
    await this.continueButton.click();

    await this.subdomainInput.fill(subdomain);
    await expect(this.page.getByText("This address is free.")).toBeVisible();
    await this.continueButton.click();

    await expect(
      this.page.getByRole("button", { name: "Add a board" })
    ).toBeVisible();
    await this.continueButton.click();

    await expect(
      this.page.getByRole("button", { name: "Add a teammate" })
    ).toBeVisible();
    await this.createButton.click();
  }

  /**
   * Closes the welcome tour if it opened.
   *
   * A first workspace lands on the dashboard with the tour up, and it is modal,
   * so every spec that wants to click on the dashboard has to get past it. The
   * tour appears once the workspace's site row has resolved, after the URL
   * changes, so this waits briefly and treats a tour that never arrives (a
   * second workspace, which does not get one) as nothing to do.
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

import { expect, test } from "../fixtures";
import {
  createAuthenticatedWorkspace,
  signUpProgrammatically,
} from "../helpers/auth";
import { createTestUser, subdomainFor } from "../helpers/test-users";
import { RegisterPage } from "../page-objects/RegisterPage";

/**
 * The register wizard.
 *
 * These cover the parts that a unit test cannot see: that Continue is usable
 * the moment a step's answers are already complete, that the address check
 * reaches the screen, and that the logo and the invitations are applied after
 * the workspace exists.
 */
test.describe("register wizard", () => {
  test("Continue is usable on a step that arrives answered, in both directions", async ({
    page,
  }) => {
    const user = createTestUser();
    await signUpProgrammatically(page, user);

    const register = new RegisterPage(page);
    await register.goto();

    await register.fillIdentity(user.workspaceName);
    await register.continue();

    await register.fillAddress(subdomainFor(user.workspaceName));
    await register.expectAddressFree();
    await register.continue();

    // The boards step opens with two named, selected rows. Nothing about it
    // changes, so a wizard that only reacted to changes left Continue disabled
    // here until an unrelated field event fired.
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

    // A new workspace is on the free plan, which allows two boards, so the two
    // defaults already fill it.
    await expect(
      page.getByRole("button", { name: "Add a board" })
    ).toBeDisabled();
    await expect(page.getByText(/free plan's limit/)).toBeVisible();

    // Back to the address, forward again: the answer belongs to the step, not
    // to the wizard, so neither direction loses it.
    await page.getByRole("button", { name: "Back" }).click();
    await register.expectAddressFree();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    await register.continue();

    // Back on the boards step, still leaveable without touching anything.
    await expect(
      page.getByRole("button", { name: "Add a board" })
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();

    // The last step invites nobody by default, so it is answered too, and its
    // button is the one that creates the workspace.
    await register.continue();
    await expect(
      page.getByRole("button", { name: "Create workspace" })
    ).toBeEnabled();
  });

  test("a taken address offers the server's suggestion", async ({ page }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const taken = subdomainFor(owner.workspaceName);

    // The same account creates a second workspace, so the first one's address
    // is the one the check has to refuse.
    const register = new RegisterPage(page);
    await register.goto();

    const user = createTestUser();
    await register.fillIdentity(user.workspaceName);
    await register.continue();

    await register.fillAddress(taken);

    await expect(
      page.getByText("Someone already has this address.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();

    const suggestion = page.getByRole("button", { name: `Use ${taken}-2` });
    await expect(suggestion).toBeVisible();
    await suggestion.click();

    await expect(register.subdomainInput).toHaveValue(`${taken}-2`);
    await register.expectAddressFree();
    await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  });

  test("applies the logo and sends the invitation after creating", async ({
    page,
  }) => {
    const user = createTestUser();
    const invitee = createTestUser();
    await signUpProgrammatically(page, user);

    const register = new RegisterPage(page);
    await register.goto();

    await register.fillIdentity(user.workspaceName);
    await register.pickLogo();
    await expect(
      page.getByRole("img", { name: "Workspace logo" }).first()
    ).toBeVisible();
    await register.continue();

    await register.fillAddress(subdomainFor(user.workspaceName));
    await register.expectAddressFree();
    await register.continue();
    await register.continue();

    await register.addInvite(invitee.email);

    const logoUpload = page.waitForResponse(
      (response) =>
        response.url().includes("/api/organization/logo") &&
        response.request().method() === "POST"
    );

    await register.submit();

    expect((await logoUpload).ok()).toBe(true);
    await expect(page).toHaveURL(/\/org_/);

    // The workspace exists at this point, so the tour is over the dashboard.
    await register.dismissWelcomeTour();

    const organizationUrl = page.url().replace(/\/$/, "");
    await page.goto(`${organizationUrl}/settings/members`);

    await expect(page.getByText(invitee.email, { exact: true })).toBeVisible();
    await expect(page.getByText("Invited as contributor")).toBeVisible();
  });
});

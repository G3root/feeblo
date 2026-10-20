import { expect, test } from "../fixtures";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { setPlan } from "../helpers/set-plan";
import { publicBoardUrl } from "../helpers/urls";

/**
 * End-to-end coverage for the over-plan gate.
 *
 * The setup is the real downgrade path: create a workspace, put it on Starter
 * through the test-only plan route, use the private-board capability, then
 * remove the subscription. The free workspace is then over plan because it
 * still holds a private board.
 *
 * Covered here:
 * 1. The snapshot redirects the dashboard to the gate, and the gate lists the
 *    private board with its remediation actions.
 * 2. The public portal is untouched and still hides the private board.
 * 3. A blocked page (members) redirects back to the gate.
 * 4. An allowed page (billing) renders with the over-plan banner.
 * 5. The typed confirmation gates "Make public" until the board name matches.
 * 6. A destructive action is also typed-confirmed, and resolving the last
 *    finding closes the gate and returns the dashboard.
 *
 * The admin-role and over-limit paths are covered by the snapshot tests and
 * the pure view-model tests; this spec keeps one downgrade and one action.
 */
test.describe("over-plan gate", () => {
  test("gates the dashboard after a downgrade and closes when the board is made public", async ({
    page,
    request,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const organizationId = new URL(owner.organizationUrl).pathname
      .split("/")
      .filter(Boolean)[0];

    if (organizationId === undefined) {
      throw new Error(
        `Could not read the organization id from ${owner.organizationUrl}`
      );
    }

    await setPlan(page.context().request, {
      organizationId,
      plan: "starter",
    });
    // A full navigation gives the dashboard a fresh plan query; the collection
    // is deliberately long-lived and does not watch the subscription table.
    await page.goto(owner.organizationUrl);
    await expect(page.getByRole("button", { name: "New board" })).toBeVisible();

    await page.getByRole("button", { name: "New board" }).click();

    const boardSheet = page.getByRole("dialog", { name: "Create Board." });
    await expect(boardSheet).toBeVisible();
    await boardSheet.getByLabel("Name").fill("Secret board");
    await boardSheet.getByRole("combobox").click();
    await page.getByRole("option", { name: "Private", exact: true }).click();
    await boardSheet.getByRole("button", { name: "Save" }).click();

    await expect(
      page.getByText("Board created successfully", { exact: true })
    ).toBeVisible();
    await expect(boardSheet).toBeHidden();

    // The downgrade: no entitled subscription means the workspace resolves to
    // Free, while the private board it created on Starter stays behind.
    await setPlan(page.context().request, {
      organizationId,
      plan: "free",
    });
    await page.goto(owner.organizationUrl);

    await expect(page).toHaveURL(`${owner.organizationUrl}/over-plan`);
    await expect(
      page.getByRole("heading", {
        name: "This workspace is over its Free plan",
      })
    ).toBeVisible();

    const secretBoardRow = page
      .getByRole("listitem")
      .filter({ hasText: "Secret board" });
    await expect(secretBoardRow).toBeVisible();
    await expect(secretBoardRow.getByText("Private")).toBeVisible();
    await expect(
      secretBoardRow.getByRole("button", { name: "Make public" })
    ).toBeVisible();

    // The gate is the dashboard's contract, not the customer's: the public
    // board still renders, and the private board is still not listed there.
    const publicResponse = await request.get(
      publicBoardUrl(owner.workspaceName)
    );
    expect(publicResponse.status()).toBe(200);
    const publicHtml = await publicResponse.text();
    expect(publicHtml).toContain(owner.workspaceName);
    expect(publicHtml).not.toContain("Secret board");

    // A workspace page the snapshot does not allow is replaced by the gate.
    await page.goto(`${owner.organizationUrl}/settings/members`);
    await expect(page).toHaveURL(`${owner.organizationUrl}/over-plan`);

    // Billing stays reachable, and the banner keeps the reason visible.
    await page.goto(`${owner.organizationUrl}/settings/billing`);
    await expect(
      page.getByRole("heading", { name: "Billing", exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("This workspace is over its Free plan", { exact: true })
    ).toBeVisible();

    await page.goto(`${owner.organizationUrl}/over-plan`);
    const row = page.getByRole("listitem").filter({ hasText: "Secret board" });
    await row.getByRole("button", { name: "Make public" }).click();

    const confirmDialog = page.getByRole("alertdialog");
    await expect(
      confirmDialog.getByText("Make Secret board public?")
    ).toBeVisible();

    const confirmButton = confirmDialog.getByRole("button", {
      name: "Make public",
    });
    await expect(confirmButton).toBeDisabled();

    await confirmDialog.getByRole("textbox").fill("Secret board");
    await expect(confirmButton).toBeEnabled();
    await confirmButton.click();

    // Making the board public removes the private finding, but the workspace
    // still has three boards on a two-board plan. The row loses its Private
    // badge and the board-count finding keeps the gate up.
    const publicSecretRow = page
      .getByRole("listitem")
      .filter({ hasText: "Secret board" });
    await expect(publicSecretRow.getByText("Private")).toBeHidden();
    await expect(
      page.getByText("3 of 2 boards", { exact: false })
    ).toBeVisible();

    const overLimitRow = page
      .getByRole("listitem")
      .filter({ hasText: "Bugs 🐞" });
    await overLimitRow.getByRole("button", { name: "Delete" }).click();

    const deleteDialog = page.getByRole("alertdialog");
    await expect(deleteDialog.getByText("Delete Bugs 🐞?")).toBeVisible();

    const deleteButton = deleteDialog.getByRole("button", {
      name: "Delete board",
    });
    await expect(deleteButton).toBeDisabled();
    await deleteDialog.getByRole("textbox").fill("Bugs 🐞");
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    // The last finding is gone; the gate navigates back to the dashboard
    // instead of waiting for a reload.
    await expect(page).toHaveURL(owner.organizationUrl);
    await expect(page.getByRole("heading", { name: /^Hello,/ })).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "This workspace is over its Free plan",
      })
    ).toBeHidden();
  });
});

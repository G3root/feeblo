import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "../fixtures";
import { createWorkspace } from "../helpers/auth";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { createPost, openPost } from "../helpers/posts";
import { waitForRpc } from "../helpers/rpc";

/**
 * Opens the actions menu of a saved view's pill.
 *
 * The strip is a row of links, and the per-view actions live in the pill's
 * context menu (edit, duplicate, delete). Right-clicking the link is the same
 * gesture a member uses; going through the overflow popover would make the test
 * depend on the strip being too narrow for the view.
 */
async function openViewMenu(page: Page, name: string) {
  await page.getByRole("link", { name }).click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: "Edit" })).toBeVisible();
}

test.describe("saved views", () => {
  test.beforeEach(({ page }) => {
    // A render error behind the sheet is still an error; log-only hooks would
    // let an uncaught exception pass as a passing test.
    trackPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    await assertNoPageErrors(page);
  });

  test("editing a view changes its filters and persists them", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const plannedTitle = `Planned ${randomUUID().slice(0, 8)}`;
    const completedTitle = `Completed ${randomUUID().slice(0, 8)}`;

    await createPost(page, plannedTitle, "Still planned.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, completedTitle, "Already shipped.");

    // Put one post in a status the edit sheet can filter on.
    await openPost(page, completedTitle);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Completed", exact: true }).click();
    await expect(page.getByText("Status updated")).toBeVisible();

    const feedbackUrl = `${workspace.organizationUrl}/feedback`;
    await page.goto(feedbackUrl);
    await expect(page.getByText(plannedTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(completedTitle, { exact: true })).toBeVisible();

    // Save the unfiltered board as a view, then edit that view's filters.
    await page.getByRole("button", { name: "New view" }).click();
    const createSheet = page.getByRole("dialog", { name: "New view" });
    await createSheet.getByRole("textbox", { name: "Name" }).fill("Triage");
    const createRpc = waitForRpc(page, "CreateSavedView");
    await createSheet.getByRole("button", { name: "Save" }).click();
    await createRpc;
    await expect(page).toHaveURL(/\/feedback\/view\//);

    await openViewMenu(page, "Triage");
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editSheet = page.getByRole("dialog", { name: "Edit view" });
    await expect(editSheet).toBeVisible();

    // The filters in the sheet are the board's own chips, wired to a draft.
    await editSheet.getByRole("button", { name: "Any status" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Completed" }).click();
    await page.keyboard.press("Escape");

    // The editor is a draft: picking a chip must not filter the board behind
    // the sheet before Save.
    await expect(page.getByText(plannedTitle, { exact: true })).toBeVisible();

    const updateRpc = waitForRpc(page, "UpdateSavedView");
    await editSheet.getByRole("button", { name: "Save" }).click();
    await updateRpc;
    await expect(editSheet).toBeHidden();
    await expect(page.getByText('Updated "Triage"')).toBeVisible();

    // The edited view is the one on screen, so the board follows it without a
    // reload; the other post leaves the result set.
    await expect(page.getByText(completedTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(plannedTitle, { exact: true })).toHaveCount(0);

    // A reload proves the filter was written to the row, not just applied to
    // the store.
    await page.reload();
    await expect(page.getByText(completedTitle, { exact: true })).toBeVisible();
    await expect(page.getByText(plannedTitle, { exact: true })).toHaveCount(0);

    // Reopening the sheet shows the stored filter, checked and editable.
    await openViewMenu(page, "Triage");
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const reopenedSheet = page.getByRole("dialog", { name: "Edit view" });
    await expect(
      reopenedSheet.getByRole("button", { name: "Completed" })
    ).toBeVisible();
  });
});

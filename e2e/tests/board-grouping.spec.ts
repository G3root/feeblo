import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "../fixtures";
import { createWorkspace } from "../helpers/auth";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { createPost } from "../helpers/posts";
import { waitForRpc } from "../helpers/rpc";

/**
 * Opens the filter menu and its "Group by" submenu.
 *
 * The menu is the toolbar's filter icon; the grouping choices are one level
 * down, so every selection starts here.
 */
async function openGroupingMenu(page: Page) {
  await page.getByRole("button", { name: "Filters" }).click();
  await page.getByRole("menuitem", { name: "Group by" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: "Status" })
  ).toBeVisible();
}

async function selectGrouping(page: Page, name: string) {
  await openGroupingMenu(page);
  await page.getByRole("menuitemradio", { name }).click();
}

test.describe("board grouping", () => {
  test.beforeEach(({ page }) => {
    trackPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    await assertNoPageErrors(page);
  });

  test("the filter menu groups the board by status, board, label, assignee and none", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const title = `Grouped ${randomUUID().slice(0, 8)}`;

    await createPost(page, title, "A post to group.");
    await page.goto(`${workspace.organizationUrl}/feedback`);
    await expect(
      page.getByRole("heading", { name: "Pending", exact: true })
    ).toBeVisible();

    await selectGrouping(page, "Board");
    await expect(
      page.getByRole("heading", { name: "Features 💡", exact: true })
    ).toBeVisible();
    // The status lanes are replaced, not added to.
    await expect(
      page.getByRole("heading", { name: "Pending", exact: true })
    ).toHaveCount(0);

    await selectGrouping(page, "Label");
    await expect(
      page.getByRole("heading", { name: "No label", exact: true })
    ).toBeVisible();

    await selectGrouping(page, "Assignee");
    await expect(
      page.getByRole("heading", { name: "Unassigned", exact: true })
    ).toBeVisible();

    await selectGrouping(page, "No grouping");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Unassigned", exact: true })
    ).toHaveCount(0);

    await selectGrouping(page, "Status");
    await expect(
      page.getByRole("heading", { name: "Pending", exact: true })
    ).toBeVisible();
  });

  test("grid mode respects the grouping", async ({ page }) => {
    const workspace = await createWorkspace(page);
    const title = `Grid grouped ${randomUUID().slice(0, 8)}`;

    await createPost(page, title, "A post to group in the grid.");
    await page.goto(`${workspace.organizationUrl}/feedback`);

    await page.getByRole("button", { name: "Display options" }).click();
    await page.getByRole("button", { name: "Toggle Board view" }).click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("heading", { name: "Pending", exact: true })
    ).toBeVisible();

    await selectGrouping(page, "Board");
    await expect(
      page.getByRole("heading", { name: "Features 💡", exact: true })
    ).toBeVisible();

    await selectGrouping(page, "Label");
    await expect(
      page.getByRole("heading", { name: "No label", exact: true })
    ).toBeVisible();

    await selectGrouping(page, "No grouping");
    await expect(page.getByText(title, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "No label", exact: true })
    ).toHaveCount(0);

    await selectGrouping(page, "Status");
    await expect(
      page.getByRole("heading", { name: "Pending", exact: true })
    ).toBeVisible();
  });

  test("a saved view stores its grouping and the edit sheet can change it", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const title = `Grouped view ${randomUUID().slice(0, 8)}`;

    await createPost(page, title, "A post for a grouped view.");
    await page.goto(`${workspace.organizationUrl}/feedback`);

    await selectGrouping(page, "Board");
    await page.getByRole("button", { name: "New view" }).click();
    const createSheet = page.getByRole("dialog", { name: "New view" });
    await createSheet.getByRole("textbox", { name: "Name" }).fill("Grouped");
    const createRpc = waitForRpc(page, "CreateSavedView");
    await createSheet.getByRole("button", { name: "Save" }).click();
    await createRpc;
    await expect(page).toHaveURL(/\/feedback\/view\//);
    await expect(
      page.getByRole("heading", { name: "Features 💡", exact: true })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Features 💡", exact: true })
    ).toBeVisible();

    // The edit sheet's grouping chip is the same control, against the draft.
    await page
      .getByRole("link", { name: "Grouped", exact: true })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: "Edit" }).click();
    const editSheet = page.getByRole("dialog", { name: "Edit view" });
    await editSheet.getByRole("button", { name: "Group by: Board" }).click();
    await page.getByRole("menuitemradio", { name: "Label" }).click();

    const updateRpc = waitForRpc(page, "UpdateSavedView");
    await editSheet.getByRole("button", { name: "Save" }).click();
    await updateRpc;
    await expect(editSheet).toBeHidden();
    await expect(
      page.getByRole("heading", { name: "No label", exact: true })
    ).toBeVisible();

    await page.reload();
    await expect(
      page.getByRole("heading", { name: "No label", exact: true })
    ).toBeVisible();
  });
});

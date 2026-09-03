import { expect, type Page } from "@playwright/test";

import { fillEditor } from "./posts";
import { publicBoardUrl } from "./urls";

/**
 * Creates a changelog entry draft through the dashboard: opens the entry
 * editor from the sidebar, fills title and body, and saves it as a draft.
 */
export async function createChangelogDraft(
  page: Page,
  title: string,
  content: string
) {
  await page.getByRole("link", { name: "Changelog", exact: true }).click();
  await page.getByRole("button", { name: "New Entry" }).click();

  await page.getByLabel("Post Title").fill(title);
  await fillEditor(page, content);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();
}

/** Opens a saved changelog entry from the dashboard sidebar by its title. */
export async function openChangelogEntry(page: Page, title: string) {
  await page.getByRole("link", { name: "Changelog", exact: true }).click();
  await page.getByRole("link", { name: title }).click();
}

/**
 * Publishes the changelog entry currently open in the editor under the given
 * slug. The publish dialog reuses the save dialog, so the slug must be set
 * there before saving.
 */
export async function publishOpenChangelogEntry(page: Page, slug: string) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();

  const dialog = page.getByRole("alertdialog", { name: "Save changelog" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Slug").fill(slug);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Changelog published")).toBeVisible();
}

/**
 * Opens a workspace's public changelog page as a visitor and resolves once
 * the page is interactive (the RSS subscribe link is visible).
 */
export async function openChangelogPage(page: Page, workspaceName: string) {
  await page.goto(`${publicBoardUrl(workspaceName)}/changelog`);
  await expect(
    page.getByRole("link", { name: "Subscribe to the changelog RSS feed" })
  ).toBeVisible();
}

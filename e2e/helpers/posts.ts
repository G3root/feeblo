import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Types content into a ProseMirror rich-text editor. Clicking can race a
 * re-render that relocates the editor (comment cards land right after a
 * submit), so poll until the editor actually has focus instead of waiting
 * fixed timeouts between attempts. Keystrokes typed into a just-created
 * editor can be dropped; keep inserting until the content actually landed
 * so the submit is never fired against an empty form.
 */
export async function fillEditor(
  page: Page,
  content: string,
  options: { index?: number; scope?: Locator } = {}
) {
  const editor = (options.scope ?? page)
    .locator(".ProseMirror")
    .nth(options.index ?? 0);
  await expect(editor).toBeVisible();

  await expect(async () => {
    await editor.click();
    await expect(editor).toBeFocused();
  }).toPass();

  await expect(async () => {
    await page.keyboard.insertText(content);
    expect((await editor.innerText()).trim().length).toBeGreaterThan(0);
  }).toPass();
}

/**
 * Creates a post through the dashboard's "New post" dialog on the default
 * "Features" board, then resolves once the post appears in the dashboard
 * post list. Callers must be on the dashboard home.
 */
export async function createPost(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "New post" }).click();

  const dialog = page.getByRole("dialog", { name: "Create Post" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Post Title").fill(title);

  // The rich-text editor currently has no accessible name, so scope the
  // implementation-level locator to the create-post dialog only, reusing
  // fillEditor's focus-and-content confirmation so a dropped insertion can
  // never reach the submit against an empty form.
  await fillEditor(page, content, { scope: dialog });

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Features 💡" }).click();

  await dialog.getByRole("button", { name: "Create Post" }).click();
  await expect(dialog).toBeHidden();

  // The recent-posts card link's accessible name is its aria-label
  // ("View <title>"), so match it exactly instead of a RegExp built from
  // the title (which misfires on regex metacharacters and substring
  // collisions with other post titles).
  await expect(
    page.getByRole("link", { name: `View ${title}`, exact: true })
  ).toBeVisible();
}

/**
 * Opens a post's dashboard detail page from the post list by its title.
 */
export async function openPost(page: Page, title: string) {
  // Same accessible name as createPost's assertion: the recent-posts card
  // link is aria-labelled "View <title>".
  await page.getByRole("link", { name: `View ${title}`, exact: true }).click();
  await expect(page.getByLabel("Post Title")).toHaveValue(title);
}

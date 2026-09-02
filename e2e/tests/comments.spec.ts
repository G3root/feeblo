import { randomUUID } from "node:crypto";

import { expect, type Locator, type Page, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

/**
 * E2E coverage for the two comment features added on the comment-features
 * branch:
 *
 * 1. Comment pinning — a member with `comments.*` can pin/unpin a comment,
 *    only one comment per post is pinned at a time (newest pin wins), the
 *    pinned comment sorts above the rest, the state survives a reload, and
 *    the actions are recorded in the post activity feed.
 *
 * 2. Comment as status update — a member with `posts.status` can move the
 *    post to a status from the comment composer; the comment is labelled
 *    "changed status to …", the transition is recorded as STATUS_CHANGED
 *    activity, the picker resets after posting, and commenting with the
 *    status the post already sits in is a no-op (no label, no activity).
 *
 * The workspace creator is the owner, so both `comments.*` and `posts.status`
 * are granted (see `ROLE_PERMISSIONS`). All flows run against the dashboard
 * post page, which renders the v2 comment display/composer.
 */

async function fillEditor(
  page: Page,
  content: string,
  options: { index?: number } = {}
) {
  const editor = page.locator(".ProseMirror").nth(options.index ?? 0);
  await expect(editor).toBeVisible();

  // Clicking can race a re-render that relocates the editor (comment cards
  // land right after a submit), so the click may land on the surrounding tab
  // panel instead of the contenteditable. Poll until the editor actually has
  // focus instead of waiting fixed timeouts between attempts.
  await expect(async () => {
    await editor.click();
    await expect(editor).toBeFocused();
  }).toPass();

  // Keystrokes typed into a just-created editor can be dropped; keep
  // inserting until the content actually landed so the submit is never fired
  // against an empty form.
  await expect(async () => {
    await page.keyboard.insertText(content);
    expect((await editor.innerText()).trim().length).toBeGreaterThan(0);
  }).toPass();
}

async function createWorkspace(page: Page) {
  const user = createTestUser();
  const workspace = await createAuthenticatedWorkspace(page, user);

  await expect(page).toHaveURL(workspace.organizationUrl);
  await expect(page.getByRole("button", { name: user.email })).toBeVisible();

  return workspace;
}

async function createPost(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "New post" }).click();

  const dialog = page.getByRole("dialog", { name: "Create Post" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Post Title").fill(title);
  await fillEditor(page, content);

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Features 💡" }).click();

  await dialog.getByRole("button", { name: "Create Post" }).click();
  await expect(dialog).toBeHidden();

  await expect(
    page.getByRole("link", { name: new RegExp(title) })
  ).toBeVisible();
}

async function openPost(page: Page, title: string) {
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByLabel("Post Title")).toHaveValue(title);
}

/**
 * The post page mounts two rich-text editors: the post content editor
 * (index 0) and the comment composer (index 1). This targets the composer.
 */
async function addComment(
  page: Page,
  content: string,
  options: { status?: string } = {}
) {
  const editor = page.locator(".ProseMirror").nth(1);
  await fillEditor(page, content, { index: 1 });

  if (options.status) {
    await page.getByRole("button", { name: "Comment options" }).click();
    await page
      .getByRole("menuitemradio", { name: options.status, exact: true })
      .click();
    // Selecting a status closes the menu (closeOnClick), so the submit
    // button next to it is never blocked by the menu's modal inert overlay.
    await expect(
      page.getByRole("menuitemradio", { name: options.status, exact: true })
    ).toHaveCount(0);
  }

  const create = waitForRpc(page, "CommentCreate");
  await page.getByRole("button", { name: "Comment Public" }).click();
  await create;

  // The composer only resets (empty editor) once the comment fully persists;
  // the reset re-mounts the editor after the RPC settles. Wait for it so the
  // next comment starts from a clean slate instead of racing the reset and
  // losing keystrokes typed into the about-to-be-unmounted editor.
  await expect(editor).toHaveText("");
}

/** The v2 comment display renders each comment inside a Card (`data-slot="card"`). */
function commentCard(page: Page, commentText: string) {
  return page
    .locator('[data-slot="card"]')
    .filter({ hasText: commentText })
    .first();
}

/** Opens the per-comment overflow menu and clicks the given menu item. */
async function togglePin(page: Page, card: ReturnType<typeof commentCard>) {
  await card.locator('[data-slot="menu-trigger"]').click();
  const item = page
    .getByRole("menuitem")
    .filter({ hasText: /Pin comment|Unpin comment/ });
  await expect(item).toBeVisible();
  await item.click();
}

/** A whole activity timeline entry, e.g. "Test User pinned a comment". */
function activityItem(page: Page, text: string | RegExp) {
  return page
    .locator('[data-slot="activity-timeline-item"]')
    .filter({ hasText: text });
}

function waitForRpc(page: Page, method: string) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/rpc") &&
      Boolean(response.request().postData()?.includes(method))
  );
}

/**
 * Retrying assertion for vertical order in the comment list: `above` must
 * render above `below` (the list reorders when a comment is pinned). Missing
 * bounding boxes map to ±Infinity so the check fails and retries instead of
 * silently passing.
 */
async function expectToBeAbove(above: Locator, below: Locator) {
  await expect(async () => {
    const [aboveY, belowY] = await Promise.all([
      (await above.boundingBox())?.y ?? Number.POSITIVE_INFINITY,
      (await below.boundingBox())?.y ?? Number.NEGATIVE_INFINITY,
    ]);
    expect(aboveY).toBeLessThan(belowY);
  }).toPass();
}

test.beforeEach(({ page }) => {
  page.on("console", (message) => {
    if (message.type() === "error") {
      console.error(`[browser console] ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    console.error(`[browser pageerror] ${error.message}`);
  });
});

test.describe("comment pinning", () => {
  test(
    "pins a comment, keeps a single pinned comment per post, and persists",
    { tag: "@critical" },
    async ({ page }) => {
      await createWorkspace(page);
      const title = `Pin post ${randomUUID().slice(0, 8)}`;
      const alpha = `Alpha comment ${randomUUID().slice(0, 8)}`;
      const beta = `Beta comment ${randomUUID().slice(0, 8)}`;

      await createPost(page, title, "Post to exercise comment pinning.");
      await openPost(page, title);

      await addComment(page, alpha);
      await addComment(page, beta);

      const alphaCard = commentCard(page, alpha);
      const betaCard = commentCard(page, beta);
      await expect(alphaCard).toBeVisible();
      await expect(betaCard).toBeVisible();

      // Newest comment first (createdAt DESC): Beta sits above Alpha.
      await expectToBeAbove(betaCard, alphaCard);

      // Pin Beta. It gets the Pinned badge and moves above Alpha.
      const pinBeta = waitForRpc(page, "CommentPin");
      await togglePin(page, betaCard);
      await pinBeta;

      await expect(betaCard.getByText("Pinned", { exact: true })).toBeVisible();
      await expect(alphaCard.getByText("Pinned", { exact: true })).toHaveCount(
        0
      );
      await expectToBeAbove(betaCard, alphaCard);

      // Pinning a second comment steals the pin: Beta loses its badge.
      const pinAlpha = waitForRpc(page, "CommentPin");
      await togglePin(page, alphaCard);
      await pinAlpha;

      await expect(page.getByText("Pinned", { exact: true })).toHaveCount(1);
      await expect(
        alphaCard.getByText("Pinned", { exact: true })
      ).toBeVisible();
      await expect(betaCard.getByText("Pinned", { exact: true })).toHaveCount(
        0
      );

      // The pin is persisted server-side: survives a reload.
      await page.reload();
      await expect(alphaCard).toBeVisible();
      await expect(
        alphaCard.getByText("Pinned", { exact: true })
      ).toBeVisible();
      await expect(page.getByText("Pinned", { exact: true })).toHaveCount(1);

      // Unpin: the badge goes away.
      const unpinAlpha = waitForRpc(page, "CommentUnpin");
      await togglePin(page, alphaCard);
      await unpinAlpha;
      await expect(page.getByText("Pinned", { exact: true })).toHaveCount(0);

      // Pin/unpin round-trips are recorded in the post activity feed.
      await page.getByRole("tab", { name: "Activity" }).click();
      await expect(activityItem(page, /\bpinned a comment\b/)).toHaveCount(2);
      await expect(activityItem(page, /unpinned a comment/)).toHaveCount(1);
    }
  );
});

test.describe("comment as status update", () => {
  test(
    "moves the post status via a comment and records a single status change",
    { tag: "@critical" },
    async ({ page }) => {
      await createWorkspace(page);
      const title = `Status post ${randomUUID().slice(0, 8)}`;
      const statusComment = `Move to in progress ${randomUUID().slice(0, 8)}`;
      const plainComment = `Plain follow-up ${randomUUID().slice(0, 8)}`;
      const noOpComment = `Already in progress ${randomUUID().slice(0, 8)}`;

      await createPost(page, title, "Post to exercise status updates.");
      await openPost(page, title);

      // Comment that also moves the post to "In Progress".
      await addComment(page, statusComment, { status: "In Progress" });

      const statusCard = commentCard(page, statusComment);
      await expect(statusCard).toBeVisible();
      await expect(
        statusCard.getByText(/changed status to In Progress/)
      ).toBeVisible();

      // The post's own status follows the comment: onInsert refetches the
      // post collection, so the sidebar status select picks up the move.
      await expect(
        page.locator("aside").getByText("In Progress", { exact: true })
      ).toBeVisible();

      // The status picker is one-shot: a plain follow-up comment neither
      // re-applies the previous status nor moves the post again.
      await addComment(page, plainComment);

      const plainCard = commentCard(page, plainComment);
      await expect(plainCard).toBeVisible();
      await expect(plainCard.getByText(/changed status to/)).toHaveCount(0);

      // Commenting with the status the post already sits in is a no-op: the
      // comment is stored without a status-update label.
      await addComment(page, noOpComment, { status: "In Progress" });

      const noOpCard = commentCard(page, noOpComment);
      await expect(noOpCard).toBeVisible();
      await expect(noOpCard.getByText(/changed status to/)).toHaveCount(0);

      // Everything persists across a reload.
      await page.reload();
      await expect(statusCard).toBeVisible();
      await expect(
        statusCard.getByText(/changed status to In Progress/)
      ).toBeVisible();
      await expect(
        page.locator("aside").getByText("In Progress", { exact: true })
      ).toBeVisible();

      // Only the first comment actually moved the post: the activity feed has
      // exactly one status transition and three comment entries.
      await page.getByRole("tab", { name: "Activity" }).click();
      await expect(
        activityItem(page, /changed the status from pending to in progress/)
      ).toHaveCount(1);
      await expect(activityItem(page, /added a comment/)).toHaveCount(3);
    }
  );
});

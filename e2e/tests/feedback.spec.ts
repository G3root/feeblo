import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createWorkspace } from "../helpers/auth";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { createPost, fillEditor, openPost } from "../helpers/posts";
import { waitForRpc } from "../helpers/rpc";
import { publicBoardUrl } from "../helpers/urls";

async function chooseFirstReaction(page: Page) {
  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page
    .locator('[role="dialog"]:visible')
    .getByRole("button", { name: "👍️", exact: true })
    .click();
}

test.describe("feedback workflow", () => {
  test.beforeEach(({ page }) => {
    // Fail on unexpected client failures (see comments.spec.ts): log-only
    // hooks let uncaught render exceptions pass silently.
    trackPageErrors(page);
  });

  test.afterEach(async ({ page }) => {
    await assertNoPageErrors(page);
  });

  test("user can create an organization", async ({ page }) => {
    const workspace = await createWorkspace(page);

    await expect(page).toHaveURL(workspace.organizationUrl);
    await expect(page.getByText("Have feedback?")).toBeVisible();
  });

  test(
    "user can create posts, comments, reactions, and upvotes",
    { tag: "@critical" },
    async ({ page }) => {
      await createWorkspace(page);

      const title = `E2E post ${randomUUID().slice(0, 8)}`;
      const postContent = "This is a product feedback post from Playwright.";
      const comment = "This is a Playwright comment.";

      await createPost(page, title, postContent);
      await openPost(page, title);

      const upvoteButton = page.getByRole("button", { name: "Upvote" });
      await expect(upvoteButton).toContainText("0");
      await upvoteButton.click();
      await expect(upvoteButton).toContainText("1");

      await chooseFirstReaction(page);
      await expect(
        page
          .getByRole("button")
          .filter({ hasText: "👍️" })
          .filter({ hasText: "1" })
      ).toBeVisible();

      await fillEditor(page, comment, { index: 1 });
      await page.getByRole("button", { name: "Comment Public" }).click();
      const commentBody = page.getByText(comment).last();
      await expect(commentBody).toBeVisible();

      // The v2 comment display renders each comment as a dense row
      // (`data-slot="comment"`), not a rounded card.
      const commentCard = page
        .locator('[data-slot="comment"]')
        .filter({ hasText: comment });
      await commentCard.getByRole("button", { name: "Add reaction" }).click();
      await page
        .locator('[role="dialog"]:visible')
        .getByRole("button", { name: "👍️", exact: true })
        .click();
      await expect(
        commentCard
          .getByRole("button")
          .filter({ hasText: "👍️" })
          .filter({ hasText: "1" })
      ).toBeVisible();
    }
  );

  test("changelog offers completed posts that have not been announced", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const completedTitle = `Completed post ${randomUUID().slice(0, 8)}`;
    const pendingTitle = `Pending post ${randomUUID().slice(0, 8)}`;

    await createPost(page, completedTitle, "This work has shipped.");
    await openPost(page, completedTitle);
    await page.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Completed", exact: true }).click();
    await expect(page.getByText("Status updated")).toBeVisible();

    await page.goto(workspace.organizationUrl);
    await createPost(page, pendingTitle, "This work is still pending.");

    await page.getByRole("link", { name: "Changelog" }).click();
    await page.getByRole("button", { name: "Create your first entry" }).click();

    await expect(
      page.getByRole("heading", { name: "Recently completed" })
    ).toBeVisible();
    const completedPost = page.getByRole("checkbox", { name: completedTitle });
    await expect(completedPost).toBeVisible();
    await expect(
      page.getByRole("checkbox", { name: pendingTitle })
    ).toHaveCount(0);

    await completedPost.check();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("checkbox", { name: completedTitle })
    ).toBeChecked();

    await page.getByLabel("Back to changelog").click();
    await page.getByRole("button", { name: "New Entry" }).click();
    await expect(
      page.getByRole("checkbox", { name: completedTitle })
    ).toHaveCount(0);
  });

  test("manager can merge a duplicate post into the current post", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, targetTitle);

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge others to this" }).click();

    // The palette footer advertises the keyboard affordances.
    await expect(page.getByText("Navigate", { exact: true })).toBeVisible();
    await expect(page.getByText("Open", { exact: true })).toBeVisible();
    await expect(page.getByText("Close", { exact: true })).toBeVisible();

    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: sourceTitle, exact: true }).click();
    await mergeRpc;

    await expect(
      page.getByText(`Merged "${sourceTitle}" into this post`)
    ).toBeVisible();
  });

  test("manager can merge the current post into an existing post", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;

    await createPost(page, sourceTitle, "Duplicate feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, targetTitle, "Canonical feedback.");
    await openPost(page, sourceTitle);

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge to existing" }).click();

    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: targetTitle, exact: true }).click();
    await mergeRpc;

    // The merged post redirects to the surviving target post.
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
  });

  test("merge carries comments over and records the merge activity", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;
    const comment = `Carried comment ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);

    // Comment on the source post before it is merged away.
    await fillEditor(page, comment, { index: 1 });
    await page.getByRole("button", { name: "Comment Public" }).click();
    await expect(page.getByText(comment).last()).toBeVisible();

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge to existing" }).click();

    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: targetTitle, exact: true }).click();
    await mergeRpc;

    // Redirected to the target, where the source comment now lives.
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
    await expect(page.getByText(comment).last()).toBeVisible();

    // The merge is recorded on the target's activity timeline.
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByText(`merged in "${sourceTitle}"`)).toBeVisible();
  });

  test("public merged post URL redirects to the surviving target", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);
    const sourceSlug = new URL(page.url()).pathname.split("/").pop();
    expect(sourceSlug).toBeTruthy();

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge to existing" }).click();

    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: targetTitle, exact: true }).click();
    await mergeRpc;
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
    const targetSlug = new URL(page.url()).pathname.split("/").pop();
    expect(targetSlug).toBeTruthy();

    // The archived source 301s to the survivor instead of 404ing.
    const boardUrl = publicBoardUrl(workspace.workspaceName);
    await page.goto(`${boardUrl}/p/${sourceSlug}`);
    await expect(page).toHaveURL(`${boardUrl}/p/${targetSlug}`);
  });

  test("post creator can toggle their subscription", async ({ page }) => {
    const title = `Subscription post ${randomUUID().slice(0, 8)}`;

    await createWorkspace(page);
    await createPost(page, title, "I want to follow this post.");
    await openPost(page, title);

    // The post creator is automatically subscribed.
    const unsubscribeButton = page.getByRole("button", {
      name: "Unsubscribe",
      exact: true,
    });
    await expect(unsubscribeButton).toBeVisible();

    // Unsubscribe, then re-subscribe.
    const deleteRpc = waitForRpc(page, "PostSubscriptionDelete");
    await unsubscribeButton.click();
    const subscribeButton = page.getByRole("button", {
      name: "Subscribe",
      exact: true,
    });
    await expect(subscribeButton).toBeVisible();
    // Wait for the RPC to settle so the reload cannot race it.
    await deleteRpc;

    // Reload to verify the unsubscribe persisted on the server.
    await page.reload();
    await expect(subscribeButton).toBeVisible();

    const createRpc = waitForRpc(page, "PostSubscriptionCreate");
    await subscribeButton.click();
    await expect(unsubscribeButton).toBeVisible();
    await createRpc;

    // Reload to verify the re-subscribe persisted on the server.
    await page.reload();
    await expect(unsubscribeButton).toBeVisible();
  });
});

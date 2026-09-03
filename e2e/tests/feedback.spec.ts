import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createWorkspace } from "../helpers/auth";
import { createPost, fillEditor, openPost } from "../helpers/posts";

/** Resolves when the given subscription RPC completes on the wire. */
function waitForSubscriptionRpc(
  page: Page,
  method: "PostSubscriptionCreate" | "PostSubscriptionDelete"
) {
  return page.waitForResponse(
    (response) =>
      response.url().includes("/rpc") &&
      Boolean(response.request().postData()?.includes(method))
  );
}

async function chooseFirstReaction(page: Page) {
  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page
    .locator('[role="dialog"]:visible')
    .getByRole("button", { name: "👍️", exact: true })
    .click();
}

test.describe("feedback workflow", () => {
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
    const deleteRpc = waitForSubscriptionRpc(page, "PostSubscriptionDelete");
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

    const createRpc = waitForSubscriptionRpc(page, "PostSubscriptionCreate");
    await subscribeButton.click();
    await expect(unsubscribeButton).toBeVisible();
    await createRpc;

    // Reload to verify the re-subscribe persisted on the server.
    await page.reload();
    await expect(unsubscribeButton).toBeVisible();
  });
});

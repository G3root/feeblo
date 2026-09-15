import { randomUUID } from "node:crypto";

import { expect, type Browser, type Page, test } from "@playwright/test";

import { createWorkspace, signUpProgrammatically } from "../helpers/auth";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { createPost, fillEditor, openPost } from "../helpers/posts";
import { waitForRpc } from "../helpers/rpc";
import {
  invitationIdFromEmail,
  waitForTestEmail,
} from "../helpers/test-mailbox";
import { createTestUser, type TestUser } from "../helpers/test-users";
import { publicBoardUrl } from "../helpers/urls";

async function chooseFirstReaction(page: Page) {
  await page.getByRole("button", { name: "Add reaction" }).first().click();
  await page
    .locator('[role="dialog"]:visible')
    .getByRole("button", { name: "👍️", exact: true })
    .click();
}

/**
 * Merges the currently viewed post into `targetTitle` through the dashboard
 * merge menu and waits for the `PostMerge` RPC. Leaves the browser on the
 * surviving post.
 */
async function mergeCurrentPostInto(page: Page, targetTitle: string) {
  await page.getByRole("button", { name: "Merge post" }).click();
  await page.getByRole("menuitem", { name: "Merge to existing" }).click();
  const mergeRpc = waitForRpc(page, "PostMerge");
  await page.getByRole("option", { name: targetTitle }).click();
  await page.getByRole("button", { name: "Merge posts" }).click();
  await mergeRpc;
  await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
}

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const appOrigin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101")
  .origin;

function membersUrl(organizationUrl: string) {
  return `${organizationUrl}/settings/members`;
}

/**
 * Invites a user through the real invitation form. Mirrors the helper in
 * member-invitations.spec.ts so role behavior is exercised through the
 * same flow the UI ships.
 */
async function inviteMember(
  page: Page,
  email: string,
  role: "contributor" | "manager" = "manager"
) {
  const form = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Invite email" }),
  });
  await form.getByRole("textbox", { name: "Invite email" }).fill(email);
  if (role !== "manager") {
    await form.getByRole("combobox").click();
    await page.getByRole("option", { name: role }).click();
  }
  await form.getByRole("button", { name: "Invite" }).click();
  await expect(
    page.getByText("Invitation sent", { exact: true })
  ).toBeVisible();
}

/**
 * Invites `invitee` as a contributor and returns a page signed in as them
 * on the owner's workspace, mirroring on-behalf.spec.ts so delete
 * eligibility runs against the real contributor role.
 */
async function signInAsContributor(
  browser: Browser,
  ownerPage: Page,
  ownerOrganizationUrl: string,
  invitee: TestUser
) {
  const inviteeContext = await browser.newContext();
  const inviteeSetupPage = await inviteeContext.newPage();
  await signUpProgrammatically(inviteeSetupPage, invitee);
  await inviteeSetupPage.close();

  await ownerPage.goto(membersUrl(ownerOrganizationUrl));
  await inviteMember(ownerPage, invitee.email, "contributor");
  const email = await waitForTestEmail(ownerPage.request, invitee.email);
  const invitationId = invitationIdFromEmail(email);
  const accepted = await inviteeContext.request.post(
    `${apiURL}/api/auth/organization/accept-invitation`,
    {
      data: { invitationId },
      headers: { Origin: appOrigin },
    }
  );
  expect(accepted.ok()).toBeTruthy();

  const contributorPage = await inviteeContext.newPage();
  trackPageErrors(contributorPage);
  await contributorPage.goto(ownerOrganizationUrl);
  await expect(
    contributorPage.getByRole("button", { name: invitee.email })
  ).toBeVisible();
  return { contributorPage, inviteeContext };
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
    await expect(page.getByText("Merge", { exact: true })).toBeVisible();
    await expect(page.getByText("Close", { exact: true })).toBeVisible();

    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: sourceTitle }).click();
    // Merging is destructive, so it asks for confirmation first.
    await page.getByRole("button", { name: "Merge posts" }).click();
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
    await page.getByRole("option", { name: targetTitle }).click();
    await page.getByRole("button", { name: "Merge posts" }).click();
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
    await page.getByRole("option", { name: targetTitle }).click();
    await page.getByRole("button", { name: "Merge posts" }).click();
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
    await page.getByRole("option", { name: targetTitle }).click();
    await page.getByRole("button", { name: "Merge posts" }).click();
    await mergeRpc;
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
    const targetSlug = new URL(page.url()).pathname.split("/").pop();
    expect(targetSlug).toBeTruthy();

    // The archived source 301s to the survivor instead of 404ing.
    const boardUrl = publicBoardUrl(workspace.workspaceName);
    await page.goto(`${boardUrl}/p/${sourceSlug}`);
    await expect(page).toHaveURL(`${boardUrl}/p/${targetSlug}`);
  });

  test("a merged post shows a banner and can be unmerged", async ({ page }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);

    const origin = new URL(page.url()).origin;
    const sourcePath = new URL(page.url()).pathname;

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge to existing" }).click();
    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: targetTitle }).click();
    await page.getByRole("button", { name: "Merge posts" }).click();
    await mergeRpc;
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);

    // The archived duplicate explains where it went.
    await page.goto(`${origin}${sourcePath}`);
    await expect(page.getByText("Post Merged")).toBeVisible();
    await expect(
      page.getByText(`This post was merged into ${targetTitle}`)
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "View post" })).toBeVisible();

    // The survivor can restore it from the same menu.
    await page.goto(workspace.organizationUrl);
    await openPost(page, targetTitle);
    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Unmerge a post" }).click();
    const unmergeRpc = waitForRpc(page, "PostUnmerge");
    await page.getByRole("option", { name: sourceTitle }).click();
    await unmergeRpc;
    await expect(page.getByText(`Restored "${sourceTitle}"`)).toBeVisible();

    // The restored post is a normal post again.
    await page.goto(`${origin}${sourcePath}`);
    await expect(page.getByLabel("Post Title")).toHaveValue(sourceTitle);
    await expect(page.getByText("Post Merged")).toHaveCount(0);
  });

  test("merge confirmation can be cancelled without merging", async ({
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
    await page.getByRole("option", { name: sourceTitle }).click();

    // Merging is destructive, so it asks for confirmation first.
    const confirmDialog = page.getByRole("alertdialog");
    await expect(
      confirmDialog.getByText(`Merge "${sourceTitle}" into this post?`)
    ).toBeVisible();
    await expect(
      confirmDialog.getByText(/move to the surviving post/)
    ).toBeVisible();

    await confirmDialog.getByRole("button", { name: "Cancel" }).click();

    // Cancelling returns to the picker without merging: no success toast,
    // and the post is untouched.
    await expect(
      page.getByPlaceholder("Search posts to merge...")
    ).toBeVisible();
    await expect(
      page.getByText(`Merged "${sourceTitle}" into this post`)
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(
      page.getByPlaceholder("Search posts to merge...")
    ).toBeHidden();
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);

    // The merge affordance is still offered afterwards.
    await page.getByRole("button", { name: "Merge post" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Merge others to this" })
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("merge carries upvotes over to the surviving post", async ({ page }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);

    // Upvote the duplicate before it is merged away, waiting for the toggle
    // to persist so the merge cannot race it.
    const upvoteResponse = waitForRpc(page, "UpvoteToggle");
    await page.getByRole("button", { name: "Upvote" }).click();
    await upvoteResponse;
    await expect(page.getByRole("button", { name: "Upvote" })).toContainText(
      "1"
    );

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge to existing" }).click();

    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: targetTitle }).click();
    await page.getByRole("button", { name: "Merge posts" }).click();
    await mergeRpc;

    // Redirected to the survivor, which now carries the source's vote.
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
    await expect(page.getByRole("button", { name: "Upvote" })).toContainText(
      "1"
    );

    // The moved vote persisted server-side: still there after a reload.
    await page.reload();
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
    await expect(page.getByRole("button", { name: "Upvote" })).toContainText(
      "1"
    );
  });

  test("merged source explains where it went and links to the survivor", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);

    const origin = new URL(page.url()).origin;
    const sourcePath = new URL(page.url()).pathname;

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge to existing" }).click();
    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: targetTitle }).click();
    await page.getByRole("button", { name: "Merge posts" }).click();
    await mergeRpc;
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);

    // The archived duplicate explains where it went.
    await page.goto(`${origin}${sourcePath}`);
    await expect(page.getByText("Post Merged")).toBeVisible();
    await expect(
      page.getByText(`This post was merged into ${targetTitle}`)
    ).toBeVisible();

    // The banner action links to the surviving post.
    await page.getByRole("link", { name: "View post" }).click();
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);

    // The source timeline records where it was merged into.
    await page.goto(`${origin}${sourcePath}`);
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(page.getByText(`merged into "${targetTitle}"`)).toBeVisible();
  });

  test("merged post can be unmerged directly from the merged post", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);

    const origin = new URL(page.url()).origin;
    const sourcePath = new URL(page.url()).pathname;

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge to existing" }).click();
    const mergeRpc = waitForRpc(page, "PostMerge");
    await page.getByRole("option", { name: targetTitle }).click();
    await page.getByRole("button", { name: "Merge posts" }).click();
    await mergeRpc;
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);

    // The tombstone offers a direct unmerge with no picker.
    await page.goto(`${origin}${sourcePath}`);
    await expect(page.getByText("Post Merged")).toBeVisible();
    await page.getByRole("button", { name: "Merge post" }).click();
    await expect(
      page.getByRole("menuitem", { name: "Unmerge this post" })
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: "Merge others to this" })
    ).toHaveCount(0);

    const unmergeRpc = waitForRpc(page, "PostUnmerge");
    await page.getByRole("menuitem", { name: "Unmerge this post" }).click();
    await unmergeRpc;
    await expect(page.getByText("Post unmerged")).toBeVisible();

    // The banner is gone and the post is a normal post again.
    await expect(page.getByText("Post Merged")).toHaveCount(0);
    await expect(page.getByLabel("Post Title")).toHaveValue(sourceTitle);

    // The unmerge is recorded on the restored post's timeline.
    await page.getByRole("tab", { name: "Activity" }).click();
    await expect(
      page.getByText(`unmerged the post from "${targetTitle}"`)
    ).toBeVisible();

    // The restore persisted server-side: still normal after a reload.
    await page.reload();
    await expect(page.getByLabel("Post Title")).toHaveValue(sourceTitle);
    await expect(page.getByText("Post Merged")).toHaveCount(0);
  });

  test("merge picker search filters candidates", async ({ page }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const firstSourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;
    const secondSourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, firstSourceTitle, "Duplicate feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, secondSourceTitle, "Duplicate feedback.");
    await openPost(page, targetTitle);

    await page.getByRole("button", { name: "Merge post" }).click();
    await page.getByRole("menuitem", { name: "Merge others to this" }).click();

    const search = page.getByPlaceholder("Search posts to merge...");
    await expect(search).toBeVisible();
    await expect(
      page.getByRole("option", { name: firstSourceTitle })
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: secondSourceTitle })
    ).toBeVisible();

    // Typing filters the candidate list down to the match.
    await search.fill(firstSourceTitle);
    await expect(
      page.getByRole("option", { name: firstSourceTitle })
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: secondSourceTitle })
    ).toHaveCount(0);

    // Closing without picking leaves the post unmerged.
    await page.keyboard.press("Escape");
    await expect(search).toBeHidden();
    await expect(page.getByLabel("Post Title")).toHaveValue(targetTitle);
  });

  test("a merged duplicate is hidden from lists and read-only until unmerged", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;
    const comment = `Own comment ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);
    await fillEditor(page, comment, { index: 1 });
    await page.getByRole("button", { name: "Comment Public" }).click();
    await expect(page.getByText(comment).last()).toBeVisible();
    const sourceUrl = page.url();

    await mergeCurrentPostInto(page, targetTitle);

    // The duplicate disappears from the dashboard list instead of lingering
    // as an archived card.
    await page.goto(workspace.organizationUrl);
    await expect(
      page.getByRole("link", { name: `View ${sourceTitle}`, exact: true })
    ).toHaveCount(0);

    // Direct navigation still opens the tombstone, but every mutation is
    // disabled until the merge is reverted.
    await page.goto(sourceUrl);
    await expect(page.getByText("Post Merged")).toBeVisible();
    await expect(page.getByLabel("Post Title")).not.toBeEditable();
    await expect(page.getByRole("button", { name: "Upvote" })).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Lock post" })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Delete post" })
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Comment Public" })
    ).toBeDisabled();

    // A merged post keeps showing the comments that belong to it, even
    // though they currently live on the survivor — and they are not labeled
    // as merged comments on their own post.
    await expect(page.getByText(comment).last()).toBeVisible();
    await expect(page.getByText("Merged comment", { exact: true })).toHaveCount(
      0
    );

    // Unmerge is the one action left, and it revives the post with its
    // comments still in place.
    await page.getByRole("button", { name: "Merge post" }).click();
    const unmergeRpc = waitForRpc(page, "PostUnmerge");
    await page.getByRole("menuitem", { name: "Unmerge this post" }).click();
    await unmergeRpc;
    await expect(page.getByText("Post unmerged")).toBeVisible();
    await expect(page.getByLabel("Post Title")).toBeEditable();
    await expect(page.getByText(comment).last()).toBeVisible();
  });

  test("merged comments are labeled and link back to their source post", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;
    const comment = `Carried comment body ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);
    await fillEditor(page, comment, { index: 1 });
    await page.getByRole("button", { name: "Comment Public" }).click();
    await expect(page.getByText(comment).last()).toBeVisible();

    await mergeCurrentPostInto(page, targetTitle);

    // The carried comment is visible on the survivor and labeled with the
    // post it came from.
    await expect(page.getByText(comment).last()).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Merged comment" })
    ).toBeVisible();

    // The duplicate is listed under the survivor's merged-posts accordion,
    // changelog-style. The link's accessible name carries the status label
    // too, so match the title as a substring.
    await page.getByRole("button", { name: /Merged posts/ }).click();
    await expect(page.getByRole("link", { name: sourceTitle })).toBeVisible();

    // The label itself links back to the source post.
    await page.getByRole("link", { name: "Merged comment" }).click();
    await expect(page.getByLabel("Post Title")).toHaveValue(sourceTitle);
  });

  test("deleting a survivor restores its merged duplicates", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;
    const comment = `Restored comment ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);
    await fillEditor(page, comment, { index: 1 });
    await page.getByRole("button", { name: "Comment Public" }).click();
    await expect(page.getByText(comment).last()).toBeVisible();

    await mergeCurrentPostInto(page, targetTitle);
    await expect(page.getByText(comment).last()).toBeVisible();

    // The survivor's delete must not be blocked by the merged child's FK.
    await page.getByRole("button", { name: "Delete post" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete Post" });
    await expect(dialog).toBeVisible();
    const deleted = waitForRpc(page, "PostDelete");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await deleted;
    await expect(page.getByText("Post deleted successfully")).toBeVisible();

    // The dialog navigates to the board, and the restored duplicate is
    // already there without a reload: deleting a survivor refetches the
    // post collection with the reverted children.
    await expect(page.getByText(sourceTitle)).toBeVisible();

    // The duplicate returns to the dashboard with its original discussion.
    await page.goto(workspace.organizationUrl);
    await expect(
      page.getByRole("link", { name: `View ${sourceTitle}`, exact: true })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: `View ${targetTitle}`, exact: true })
    ).toHaveCount(0);
    await openPost(page, sourceTitle);
    await expect(page.getByText(comment).last()).toBeVisible();
  });

  test("merging into a previously visited survivor renders fresh content", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const targetTitle = `Merge target ${randomUUID().slice(0, 8)}`;
    const sourceTitle = `Merge source ${randomUUID().slice(0, 8)}`;
    const comment = `Carried comment ${randomUUID().slice(0, 8)}`;

    await createPost(page, targetTitle, "Canonical feedback.");
    // Visit the survivor first so its detail and comment subsets are already
    // cached on the client before the merge moves engagement onto it.
    await openPost(page, targetTitle);
    const targetComment = `Survivor comment ${randomUUID().slice(0, 8)}`;
    await fillEditor(page, targetComment, { index: 1 });
    await page.getByRole("button", { name: "Comment Public" }).click();
    await expect(page.getByText(targetComment).last()).toBeVisible();
    await page.goto(workspace.organizationUrl);
    await createPost(page, sourceTitle, "Duplicate feedback.");
    await openPost(page, sourceTitle);
    await fillEditor(page, comment, { index: 1 });
    await page.getByRole("button", { name: "Comment Public" }).click();
    await expect(page.getByText(comment).last()).toBeVisible();

    await mergeCurrentPostInto(page, targetTitle);

    // The redirect must not leave the child's editor content or the cached
    // (pre-merge) survivor comments on screen.
    await expect(page.locator(".ProseMirror").first()).toContainText(
      "Canonical feedback."
    );
    await expect(page.getByText(targetComment).last()).toBeVisible();
    await expect(page.getByText(comment).last()).toBeVisible();
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

  test("manager can delete a post after it gains engagement", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const title = `Delete engaged post ${randomUUID().slice(0, 8)}`;

    await createPost(page, title, "Post to delete after engagement.");
    await openPost(page, title);

    // The comment drops the post out of the contributor eligibility set.
    // A `posts.*` holder must still be able to delete it; eligibility only
    // gates contributors.
    await fillEditor(page, "Engagement comment", { index: 1 });
    await page.getByRole("button", { name: "Comment Public" }).click();
    await expect(page.getByText("Engagement comment").last()).toBeVisible();

    await page.getByRole("button", { name: "Delete post" }).click();
    const dialog = page.getByRole("alertdialog", { name: "Delete Post" });
    await expect(dialog).toBeVisible();

    const deleted = waitForRpc(page, "PostDelete");
    await dialog.getByRole("button", { name: "Continue" }).click();
    await deleted;

    await expect(page.getByText("Post deleted successfully")).toBeVisible();

    await page.goto(workspace.organizationUrl);
    await expect(
      page.getByRole("link", { name: `View ${title}`, exact: true })
    ).toHaveCount(0);
  });

  test("contributor delete eligibility only covers untouched own posts", async ({
    browser,
    page,
  }) => {
    const owner = await createWorkspace(page);
    const invitee = createTestUser();
    const { contributorPage, inviteeContext } = await signInAsContributor(
      browser,
      page,
      owner.organizationUrl,
      invitee
    );

    try {
      // Own untouched post: eligible, so deletion goes through.
      const untouchedTitle = `Contributor untouched ${randomUUID().slice(0, 8)}`;
      await createPost(
        contributorPage,
        untouchedTitle,
        "My own untouched post."
      );
      await openPost(contributorPage, untouchedTitle);

      await contributorPage
        .getByRole("button", { name: "Delete post" })
        .click();
      const deleteDialog = contributorPage.getByRole("alertdialog", {
        name: "Delete Post",
      });
      const deleted = waitForRpc(contributorPage, "PostDelete");
      await deleteDialog.getByRole("button", { name: "Continue" }).click();
      await deleted;
      await expect(
        contributorPage.getByText("Post deleted successfully")
      ).toBeVisible();

      // Own engaged post: no longer eligible, so the affordance stays
      // disabled and the contributor cannot bypass the check.
      await contributorPage.goto(owner.organizationUrl);
      const engagedTitle = `Contributor engaged ${randomUUID().slice(0, 8)}`;
      await createPost(contributorPage, engagedTitle, "My own engaged post.");
      await openPost(contributorPage, engagedTitle);
      await fillEditor(contributorPage, "Engaging comment", { index: 1 });
      await contributorPage
        .getByRole("button", { name: "Comment Public" })
        .click();
      await expect(
        contributorPage.getByText("Engaging comment").last()
      ).toBeVisible();

      await expect(
        contributorPage.getByRole("button", { name: "Delete post" })
      ).toBeDisabled();

      await assertNoPageErrors(contributorPage);
    } finally {
      await inviteeContext.close();
    }
  });
});

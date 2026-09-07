import { randomUUID } from "node:crypto";

import {
  expect,
  type Browser,
  type Locator,
  type Page,
  test,
} from "@playwright/test";

import {
  createAuthenticatedWorkspace,
  createWorkspace,
  signUpProgrammatically,
} from "../helpers/auth";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { createPost, fillEditor, openPost } from "../helpers/posts";
import { waitForRpc } from "../helpers/rpc";
import {
  getTestEmails,
  invitationIdFromEmail,
  waitForTestEmail,
} from "../helpers/test-mailbox";
import { createTestUser, type TestUser } from "../helpers/test-users";
import { publicBoardUrl } from "../helpers/urls";

/**
 * E2E coverage for the on-behalf attribution PR (posts, voters, comments).
 *
 * Canonical reference: `docs/on-behalf.md`. Every dashboard on-behalf action
 * resolves its subject through `ResolvePrincipalService`, records
 * actor-plus-subject provenance in `post_activity.metadata`, and notifies
 * only across a real access boundary (deferred subjects get nothing).
 *
 * Covered here:
 * 1. Post on behalf of a new customer (create-new entry) + provenance + no
 *    email to the deferred subject.
 * 2. Post on behalf of an existing contact picked from search.
 * 3. Clearing the picked post author returns the dialog to self-authorship.
 * 4. Dashboard author reassignment (`PostUpdateAuthor`) via search and via
 *    the new-user dialog, with activity provenance and permission gating.
 * 5. Voter add via the picker, Already-voted guard, add via the new-user
 *    dialog (with validation), and removal — each with activity provenance.
 * 6. Comment as a customer via the options popover, author reset after
 *    submit, and activity provenance.
 * 7. Mutual exclusivity of status updates and comment-as-customer.
 * 8. Role gating: contributor keeps `votes.onBehalf` but sees no post or
 *    comment on-behalf controls (no `Post author` picker, no
 *    `Change author` field, no comment options).
 * 9. Picker guidance states (min length, empty, create-new, exact-email).
 * 10. Public-board rendering of on-behalf attribution.
 *
 * The workspace creator is the owner, so all three on-behalf permissions are
 * granted unless a test explicitly invites a contributor.
 *
 * Post-create attribution uses the shared `AuthorPicker` (`Post author`
 * trigger in the dialog footer, search input portalled to `document.body`),
 * while voters/comments use `ContactCombobox` inline in their popovers.
 */

function composerScope(page: Page) {
  return page.locator('[data-slot="comment-composer"]');
}

function commentCard(page: Page, text: string) {
  return page
    .locator('[data-slot="comment"]')
    .filter({ hasText: text })
    .first();
}

function activityItem(page: Page, text: string | RegExp) {
  return page
    .locator('[data-slot="activity-timeline-item"]')
    .filter({ hasText: text });
}

/**
 * Parks the pointer away from a toast and waits for it to auto-dismiss.
 * Lingering toasts pause their timers while hovered and can overlap popover
 * options or menu triggers.
 */
async function dismissToast(page: Page, title: string) {
  await page.mouse.move(0, 0);
  await expect(page.getByText(title, { exact: true })).toBeHidden({
    timeout: 15_000,
  });
}

function newCustomerEmail() {
  return `customer-${randomUUID().slice(0, 8)}@example.com`.toLowerCase();
}

function newCustomerName() {
  return `Customer ${randomUUID().slice(0, 8)}`;
}

/**
 * Searches the combobox labelled `label` for `query` and picks the result
 * row containing `rowText` (a contact name or email).
 *
 * Used for the inline `ContactCombobox` surfaces (voters, comments) whose
 * input lives in place. The `AuthorPicker` surfaces (post create,
 * dashboard reassignment) portal their input to `document.body` — use
 * `pickPostAuthor*` / `reassignAuthor*` below for those.
 */
async function pickExistingContact(
  page: Page,
  label: string,
  query: string,
  rowText: string
) {
  const input = page.getByRole("combobox", { name: label });
  await expect(input).toBeVisible();
  await input.click();
  await input.fill(query);

  const row = page.getByRole("option").filter({ hasText: rowText }).first();
  await expect(row).toBeVisible();
  await row.click();

  await expect(page.getByRole("combobox", { name: label })).toHaveCount(0);
}

/**
 * Opens the post-create `AuthorPicker` (`Post author` trigger in the dialog
 * footer). The search input portals to `document.body`, so it is queried
 * on `page` while the trigger stays scoped to `dialog`.
 */
async function openPostAuthorPicker(page: Page, dialog: Locator) {
  const trigger = dialog.getByRole("button", { name: /Post author/ });
  await expect(trigger).toBeVisible();
  await trigger.click();
  await expect(
    page.getByRole("combobox", { name: "Post author" })
  ).toBeVisible();
}

/**
 * Picks a brand-new customer in the post-create picker via the synthetic
 * "as new customer" entry. Resolves once the popover closes and the dialog
 * trigger shows the picked email, proving the selection landed in form state.
 */
async function pickPostAuthorNewCustomer(
  page: Page,
  dialog: Locator,
  email: string
) {
  await openPostAuthorPicker(page, dialog);
  const input = page.getByRole("combobox", { name: "Post author" });
  await input.click();
  await input.fill(email);

  const createOption = page
    .getByRole("option")
    .filter({ hasText: email })
    .filter({ hasText: /as new customer/ });
  await expect(createOption).toBeVisible();
  await createOption.click();

  // Picking closes the popover; the trigger now displays the picked email.
  await expect(page.getByRole("combobox", { name: "Post author" })).toHaveCount(
    0
  );
  await expect(dialog.getByText(email).first()).toBeVisible();
}

/**
 * Picks an existing contact in the post-create picker by searching `query`
 * and choosing the row containing `rowText` (contact name or email).
 */
async function pickPostAuthorExisting(
  page: Page,
  dialog: Locator,
  query: string,
  rowText: string
) {
  await openPostAuthorPicker(page, dialog);
  const input = page.getByRole("combobox", { name: "Post author" });
  await input.click();
  await input.fill(query);

  const row = page.getByRole("option").filter({ hasText: rowText }).first();
  await expect(row).toBeVisible();
  await row.click();

  await expect(page.getByRole("combobox", { name: "Post author" })).toHaveCount(
    0
  );
  await expect(dialog.getByText(rowText).first()).toBeVisible();
}

/**
 * Reassigns a post's author through the dashboard `Change author` field via
 * the "Add a brand new user" dialog. Resolves once the success toast
 * appears and the trigger shows the new name.
 */
async function reassignAuthorThroughDialog(
  page: Page,
  name: string,
  email: string
) {
  await page.getByRole("button", { name: /Change author/ }).click();
  await expect(
    page.getByRole("combobox", { name: "Change author" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Add a brand new user" }).click();

  const dialog = page.getByRole("dialog", { name: "New user" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Email").fill(email);

  const updated = waitForRpc(page, "PostUpdateAuthor");
  // Dashboard reassignment uses the shared picker's default submit label.
  await dialog.getByRole("button", { name: "Create & set author" }).click();
  await updated;
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Author updated", { exact: true })).toBeVisible();
}

/**
 * Reassigns a post's author through the dashboard `Change author` field by
 * searching `query` and picking the row containing `rowText`.
 */
async function reassignAuthorThroughSearch(
  page: Page,
  query: string,
  rowText: string
) {
  await page.getByRole("button", { name: /Change author/ }).click();
  const input = page.getByRole("combobox", { name: "Change author" });
  await expect(input).toBeVisible();
  await input.click();
  await input.fill(query);

  const row = page.getByRole("option").filter({ hasText: rowText }).first();
  await expect(row).toBeVisible();
  const updated = waitForRpc(page, "PostUpdateAuthor");
  await row.click();
  await updated;
  await expect(page.getByText("Author updated", { exact: true })).toBeVisible();
}

/**
 * Creates a post through the dashboard dialog attributed to a brand-new
 * customer typed into the on-behalf picker. Returns the customer email so
 * callers can assert provenance and mailbox side effects.
 */
async function createPostOnBehalfOfNewCustomer(
  page: Page,
  title: string,
  content: string,
  customerEmail: string
) {
  await page.getByRole("button", { name: "New post" }).click();
  const dialog = page.getByRole("dialog", { name: "Create Post" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Post Title").fill(title);
  await fillEditor(page, content, { scope: dialog });
  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Features 💡" }).click();

  // The shared AuthorPicker lives in the dialog footer; its search input
  // portals to document.body. Picking closes the popover and the trigger
  // shows the picked email, proving the selection landed in form state.
  await pickPostAuthorNewCustomer(page, dialog, customerEmail);
  await expect(dialog.getByText(customerEmail).first()).toBeVisible();

  const created = waitForRpc(page, "PostCreate");
  await dialog.getByRole("button", { name: "Create Post" }).click();
  await created;
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("link", { name: `View ${title}`, exact: true })
  ).toBeVisible();
}

/** Opens the voter popover on the dashboard post page. */
async function openAddVoterPopover(page: Page) {
  await expect(page.getByRole("region", { name: "Voters" })).toBeVisible();
  await page.getByRole("button", { name: "Add voter" }).click();
  await expect(page.getByRole("combobox", { name: "Add voter" })).toBeVisible();
}

/**
 * Adds a voter through the shared new-user dialog (footer entry point).
 * Returns the submitted name/email for provenance assertions.
 */
async function addVoterThroughDialog(page: Page, name: string, email: string) {
  await openAddVoterPopover(page);
  await page.getByRole("button", { name: "Add new upvoter" }).click();

  const dialog = page.getByRole("dialog", { name: "New user" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Email").fill(email);

  const added = waitForRpc(page, "UpvoteAddOnBehalf");
  await dialog.getByRole("button", { name: "Create & add vote" }).click();
  await added;
  await expect(dialog).toBeHidden();
}

/** Opens the voters dialog listing every voter for the post. */
async function openVotersDialog(page: Page) {
  await page.getByRole("button", { name: /^Show all \d+ voters$/ }).click();
  const dialog = page.getByRole("dialog", { name: /^Voters \(\d+\)$/ });
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * Stages a comment-as-customer author through the composer's "Add new
 * author" dialog. The author is staged in form state — no RPC fires until
 * the comment itself is submitted.
 */
async function stageCommentAuthorThroughDialog(
  page: Page,
  name: string,
  email: string
) {
  await page.getByRole("button", { name: "Comment options" }).click();
  await expect(
    page.getByText("Comment as customer", { exact: true })
  ).toBeVisible();
  await page.getByRole("button", { name: "Add new author" }).click();

  const dialog = page.getByRole("dialog", { name: "New user" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByRole("button", { name: "Add author" }).click();
  await expect(dialog).toBeHidden();

  // Staging replaces the picker with a summary row. The modal dialog closes
  // the popover, so reopen to confirm the staged subject before submitting.
  await page.getByRole("button", { name: "Comment options" }).click();
  await expect(page.getByText(email)).toBeVisible();
  await page.keyboard.press("Escape");
}

async function openActivityTab(page: Page) {
  await page.getByRole("tab", { name: "Activity" }).click();
}

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const appOrigin = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101")
  .origin;

function membersUrl(organizationUrl: string) {
  return `${organizationUrl}/settings/members`;
}

async function inviteMember(
  page: Page,
  email: string,
  role: "contributor" | "manager" | "admin" = "manager"
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
 * on the owner's workspace. Mirrors member-invitations.spec.ts so the role
 * matrix is exercised through the real invitation flow, not a stubbed
 * policy.
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

test.beforeEach(({ page }) => {
  // Fail on unexpected client failures instead of only logging them: an
  // uncaught render exception passes silently whenever the asserted
  // elements still resolve.
  trackPageErrors(page);
});

test.afterEach(async ({ page }) => {
  await assertNoPageErrors(page);
});

test.describe("posts on behalf", () => {
  test(
    "creates a post for a new customer and records provenance without emailing them",
    { tag: "@critical" },
    async ({ page }) => {
      await createWorkspace(page);
      const title = `On-behalf post ${randomUUID().slice(0, 8)}`;
      const customerEmail = newCustomerEmail();

      await createPostOnBehalfOfNewCustomer(
        page,
        title,
        "Feedback that arrived by email.",
        customerEmail
      );
      await dismissToast(page, "Post created successfully");
      await openPost(page, title);

      // Provenance lives in the activity timeline as actor-plus-subject.
      await openActivityTab(page);
      await expect(activityItem(page, /created this post/)).toBeVisible();
      await expect(
        activityItem(page, /on behalf of/).filter({ hasText: customerEmail })
      ).toBeVisible();

      // Attribution never grants notification: a deferred subject's mailbox
      // stays empty even though the post exists.
      await page.reload();
      await openActivityTab(page);
      await expect(
        activityItem(page, /on behalf of/).filter({ hasText: customerEmail })
      ).toBeVisible();
      const emails = await getTestEmails(page.request);
      expect(
        emails.filter((email) => email.to.toLowerCase() === customerEmail)
      ).toHaveLength(0);
    }
  );

  test(
    "attributes a post to an existing contact picked from search",
    { tag: "@critical" },
    async ({ page }) => {
      const workspace = await createWorkspace(page);
      const customerName = newCustomerName();
      const customerEmail = newCustomerEmail();

      // Seed a named contact through the voter dialog so the picker has a
      // real result row (not just the create-new entry) to select.
      const seedTitle = `Seed post ${randomUUID().slice(0, 8)}`;
      await createPost(page, seedTitle, "Seeding a contact for search.");
      await dismissToast(page, "Post created successfully");
      await openPost(page, seedTitle);
      await addVoterThroughDialog(page, customerName, customerEmail);
      await expect(page.getByText("Voters (1)")).toBeVisible();

      await page.goto(workspace.organizationUrl);
      const title = `Picked post ${randomUUID().slice(0, 8)}`;
      await page.getByRole("button", { name: "New post" }).click();
      const dialog = page.getByRole("dialog", { name: "Create Post" });
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Post Title").fill(title);
      await fillEditor(page, "Picked from the people picker.", {
        scope: dialog,
      });
      await dialog.getByRole("combobox").first().click();
      await page.getByRole("option", { name: "Features 💡" }).click();

      // Searching the contact's name surfaces their row; picking it closes
      // the popover and shows the name in the dialog trigger.
      await pickPostAuthorExisting(
        page,
        dialog,
        customerName.slice(0, 12),
        customerName
      );

      const created = waitForRpc(page, "PostCreate");
      await dialog.getByRole("button", { name: "Create Post" }).click();
      await created;
      await expect(dialog).toBeHidden();
      await expect(
        page.getByRole("link", { name: `View ${title}`, exact: true })
      ).toBeVisible();

      await dismissToast(page, "Post created successfully");
      await openPost(page, title);
      await openActivityTab(page);
      await expect(
        activityItem(page, /on behalf of/).filter({ hasText: customerName })
      ).toBeVisible();
    }
  );

  test("removing the picked post author restores self-authorship", async ({
    page,
  }) => {
    const workspace = await createWorkspace(page);
    const title = `Cleared author ${randomUUID().slice(0, 8)}`;
    const customerEmail = newCustomerEmail();

    await page.getByRole("button", { name: "New post" }).click();
    const dialog = page.getByRole("dialog", { name: "Create Post" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Post Title").fill(title);
    await fillEditor(page, "The author pick is one-shot.", {
      scope: dialog,
    });
    await dialog.getByRole("combobox").first().click();
    await page.getByRole("option", { name: "Features 💡" }).click();

    // Pick a new customer: the popover closes and the trigger shows the
    // picked email.
    await pickPostAuthorNewCustomer(page, dialog, customerEmail);

    // Reopening the picker surfaces the picked summary with its dismiss
    // control; clearing it returns the combobox to search mode so nothing
    // rides along on submit. The popover stays open after a clear so
    // another person can be picked without reopening it.
    await dialog.getByRole("button", { name: /Post author/ }).click();
    await expect(
      page.getByRole("combobox", { name: "Post author" })
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Remove selected person" }).click();
    await expect(
      page.getByRole("combobox", { name: "Post author" })
    ).toBeVisible();
    await page.keyboard.press("Escape");
    // The trigger falls back to the session user once the pick is cleared.
    await expect(dialog.getByText(customerEmail)).toHaveCount(0);
    await expect(
      dialog.getByRole("button", { name: /Post author/ })
    ).toBeVisible();
    // The session fallback displays the workspace owner's name.
    await expect(
      dialog.getByRole("button", { name: new RegExp(workspace.name) })
    ).toBeVisible();

    const created = waitForRpc(page, "PostCreate");
    await dialog.getByRole("button", { name: "Create Post" }).click();
    await created;
    await expect(dialog).toBeHidden();
    await dismissToast(page, "Post created successfully");
    await openPost(page, title);
    await openActivityTab(page);
    // Self-authored: no on-behalf suffix on the creation entry.
    await expect(activityItem(page, /created this post/)).toBeVisible();
    await expect(activityItem(page, /on behalf of/)).toHaveCount(0);
  });
});

test.describe("voters on behalf", () => {
  test(
    "adds a voter from the picker and blocks a duplicate vote",
    { tag: "@critical" },
    async ({ page }) => {
      const workspace = await createWorkspace(page);
      const customerName = newCustomerName();
      const customerEmail = newCustomerEmail();

      // Seed the contact on one post so the voter picker on the next post
      // exercises the real ContactSearch result path.
      const seedTitle = `Voter seed ${randomUUID().slice(0, 8)}`;
      await createPost(page, seedTitle, "Seeding the voter contact.");
      await dismissToast(page, "Post created successfully");
      await openPost(page, seedTitle);
      await addVoterThroughDialog(page, customerName, customerEmail);

      const title = `Voter post ${randomUUID().slice(0, 8)}`;
      await page.goto(workspace.organizationUrl);
      await createPost(page, title, "Post to exercise voter management.");
      await dismissToast(page, "Post created successfully");
      await openPost(page, title);
      await expect(page.getByText("Voters (0)")).toBeVisible();

      // Add the seeded contact through the picker (not the dialog).
      await openAddVoterPopover(page);
      await pickExistingContact(page, "Add voter", customerEmail, customerName);
      await expect(page.getByText("Voters (1)")).toBeVisible();

      const votersDialog = await openVotersDialog(page);
      await expect(votersDialog.getByText(customerName)).toBeVisible();
      await page.keyboard.press("Escape");

      // Searching the same voter again surfaces the Already-voted badge and
      // a disabled row: clicking it must not add a second vote.
      await openAddVoterPopover(page);
      const input = page.getByRole("combobox", { name: "Add voter" });
      await input.click();
      await input.fill(customerEmail);
      const votedRow = page
        .getByRole("option")
        .filter({ hasText: customerName })
        .first();
      await expect(votedRow).toBeVisible();
      await expect(
        page.getByRole("option").filter({ hasText: "Already voted" })
      ).toBeVisible();
      expect(await votedRow.getAttribute("aria-disabled")).toBe("true");
      await page.keyboard.press("Escape");

      await expect(page.getByText("Voters (1)")).toBeVisible();

      // The add is activity-logged with provenance.
      await openActivityTab(page);
      await expect(
        activityItem(page, /added a voter/).filter({ hasText: customerName })
      ).toBeVisible();
      await expect(
        activityItem(page, /on behalf of/).filter({ hasText: customerName })
      ).toBeVisible();
    }
  );

  test(
    "adds a new voter through the dialog and removes them",
    { tag: "@critical" },
    async ({ page }) => {
      await createWorkspace(page);
      const title = `Voter dialog post ${randomUUID().slice(0, 8)}`;
      const customerName = newCustomerName();
      const customerEmail = newCustomerEmail();

      await createPost(page, title, "Post to exercise the voter dialog.");
      await dismissToast(page, "Post created successfully");
      await openPost(page, title);

      // Dialog validation mirrors the shared form: name is required and the
      // email must parse before anything is submitted.
      await openAddVoterPopover(page);
      await page.getByRole("button", { name: "Add new upvoter" }).click();
      const dialog = page.getByRole("dialog", { name: "New user" });
      await expect(dialog).toBeVisible();
      await expect(
        dialog.getByRole("button", { name: "Create & add vote" })
      ).toBeDisabled();
      await dialog.getByLabel("Name").fill(customerName);
      await dialog.getByLabel("Email").fill("not-an-email");
      await dialog.getByRole("button", { name: "Create & add vote" }).click();
      await expect(
        dialog.getByText("Enter a valid email address")
      ).toBeVisible();

      await dialog.getByLabel("Email").fill(customerEmail);
      const added = waitForRpc(page, "UpvoteAddOnBehalf");
      await dialog.getByRole("button", { name: "Create & add vote" }).click();
      await added;
      await expect(dialog).toBeHidden();
      await expect(page.getByText("Voters (1)")).toBeVisible();

      const votersDialog = await openVotersDialog(page);
      await expect(votersDialog.getByText(customerName)).toBeVisible();
      await page.keyboard.press("Escape");

      // Removal is confirm-free, activity-logged, and re-addable.
      const listDialog = await openVotersDialog(page);
      const remove = listDialog.getByRole("button", {
        name: `Remove voter ${customerName}`,
      });
      await remove.hover();
      const removed = waitForRpc(page, "UpvoteRemoveOnBehalf");
      await remove.click();
      await removed;
      await expect(page.getByText("Voters (0)")).toBeVisible();

      await openActivityTab(page);
      await expect(
        activityItem(page, /added a voter/).filter({ hasText: customerName })
      ).toBeVisible();
      await expect(
        activityItem(page, /removed a voter/).filter({
          hasText: customerName,
        })
      ).toBeVisible();
    }
  );
});

test.describe("comments on behalf", () => {
  test(
    "publishes a comment as a customer and resets the author",
    { tag: "@critical" },
    async ({ page }) => {
      await createWorkspace(page);
      const title = `Comment post ${randomUUID().slice(0, 8)}`;
      const customerName = newCustomerName();
      const customerEmail = newCustomerEmail();
      const onBehalfComment = `On behalf says hi ${randomUUID().slice(0, 8)}`;
      const followUpComment = `Staff follow-up ${randomUUID().slice(0, 8)}`;

      await createPost(page, title, "Post to exercise comment attribution.");
      await dismissToast(page, "Post created successfully");
      await openPost(page, title);

      await stageCommentAuthorThroughDialog(page, customerName, customerEmail);

      // The staged author rides along with the next submit only.
      await fillEditor(page, onBehalfComment, { scope: composerScope(page) });
      const created = waitForRpc(page, "CommentCreate");
      await page.getByRole("button", { name: "Comment Public" }).click();
      await created;

      const onBehalfCard = commentCard(page, onBehalfComment);
      await expect(onBehalfCard).toBeVisible();
      await expect(onBehalfCard.getByText(customerName)).toBeVisible();
      await expect(composerScope(page).locator(".ProseMirror")).toHaveText("");

      // The picker is one-shot: reopening the options shows a fresh search
      // input, not the previous subject.
      await page.getByRole("button", { name: "Comment options" }).click();
      await expect(
        page.getByRole("combobox", { name: "Comment as customer" })
      ).toBeVisible();
      await page.keyboard.press("Escape");

      // The next comment is authored by the session user again.
      await fillEditor(page, followUpComment, { scope: composerScope(page) });
      const second = waitForRpc(page, "CommentCreate");
      await page.getByRole("button", { name: "Comment Public" }).click();
      await second;
      const followUpCard = commentCard(page, followUpComment);
      await expect(followUpCard).toBeVisible();
      await expect(followUpCard.getByText(customerName)).toHaveCount(0);

      await openActivityTab(page);
      await expect(
        activityItem(page, /added a comment/).filter({
          hasText: customerName,
        })
      ).toBeVisible();
      await expect(
        activityItem(page, /on behalf of/).filter({ hasText: customerName })
      ).toBeVisible();

      const emails = await getTestEmails(page.request);
      expect(
        emails.filter((email) => email.to.toLowerCase() === customerEmail)
      ).toHaveLength(0);
    }
  );

  test("attributes a comment to an existing contact from the picker", async ({
    page,
  }) => {
    await createWorkspace(page);
    const customerName = newCustomerName();
    const customerEmail = newCustomerEmail();
    const title = `Picker comment ${randomUUID().slice(0, 8)}`;
    const commentText = `Picker attribution ${randomUUID().slice(0, 8)}`;

    await createPost(page, title, "Post to exercise picker attribution.");
    await dismissToast(page, "Post created successfully");
    await openPost(page, title);
    // Seed the contact so the comment picker has a result row.
    await addVoterThroughDialog(page, customerName, customerEmail);

    await page.getByRole("button", { name: "Comment options" }).click();
    await pickExistingContact(
      page,
      "Comment as customer",
      customerEmail,
      customerName
    );
    // Picking closes the popover but stages the subject in form state; the
    // next submit attributes to them without reopening.

    await fillEditor(page, commentText, { scope: composerScope(page) });
    const created = waitForRpc(page, "CommentCreate");
    await page.getByRole("button", { name: "Comment Public" }).click();
    await created;
    const card = commentCard(page, commentText);
    await expect(card).toBeVisible();
    await expect(card.getByText(customerName)).toBeVisible();
  });

  test("keeps status updates and comment-as-customer mutually exclusive", async ({
    page,
  }) => {
    await createWorkspace(page);
    const title = `Exclusivity post ${randomUUID().slice(0, 8)}`;

    await createPost(page, title, "Post to exercise option exclusivity.");
    await dismissToast(page, "Post created successfully");
    await openPost(page, title);

    await page.getByRole("button", { name: "Comment options" }).click();
    const authorInput = page.getByRole("combobox", {
      name: "Comment as customer",
    });
    await expect(authorInput).toBeVisible();
    await expect(authorInput).toBeEnabled();

    // The status picker lives in the status section of the popover. Scope
    // through its aria-label: the trigger button carries no stable
    // accessible name until a status is chosen.
    const statusSection = page.locator(
      'section[aria-label="Comment as status update"]'
    );
    await expect(statusSection).toBeVisible();
    const statusTrigger = statusSection.getByRole("combobox").first();
    await expect(statusTrigger).toBeVisible();

    // Picking a status disables authorship picking.
    await statusTrigger.click();
    await page
      .getByRole("option", { name: "In Progress", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Status update: In Progress" })
    ).toBeVisible();
    await expect(authorInput).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Add new author" })
    ).toBeDisabled();

    // Clearing the status re-enables the author picker.
    await page.getByRole("button", { name: "Remove status update" }).click();
    await expect(authorInput).toBeEnabled();

    // Staging an author disables the status picker in the other direction.
    // The dialog closes the popover, so reopen it to assert the trigger.
    const customerName = newCustomerName();
    const customerEmail = newCustomerEmail();
    await page.getByRole("button", { name: "Add new author" }).click();
    const dialog = page.getByRole("dialog", { name: "New user" });
    await dialog.getByLabel("Name").fill(customerName);
    await dialog.getByLabel("Email").fill(customerEmail);
    await dialog.getByRole("button", { name: "Add author" }).click();
    await expect(dialog).toBeHidden();
    await page.getByRole("button", { name: "Comment options" }).click();
    await expect(
      page
        .locator('section[aria-label="Comment as status update"]')
        .getByRole("combobox")
        .first()
    ).toBeDisabled();
  });
});

test.describe("permissions", () => {
  test(
    "contributor manages voters but sees no post or comment on-behalf controls",
    { tag: "@critical" },
    async ({ browser, page }) => {
      const owner = await createWorkspace(page);
      const title = `Gated post ${randomUUID().slice(0, 8)}`;
      await createPost(page, title, "Post to exercise permission gating.");
      await dismissToast(page, "Post created successfully");

      const contributor = createTestUser();
      const { contributorPage, inviteeContext } = await signInAsContributor(
        browser,
        page,
        owner.organizationUrl,
        contributor
      );

      try {
        // Post creation: the author picker is manager+ only, so the
        // contributor dialog has no `Post author` trigger at all.
        await contributorPage.getByRole("button", { name: "New post" }).click();
        const contributorDialog = contributorPage.getByRole("dialog", {
          name: "Create Post",
        });
        await expect(contributorDialog).toBeVisible();
        await expect(
          contributorDialog.getByRole("button", { name: /Post author/ })
        ).toHaveCount(0);
        await contributorPage.keyboard.press("Escape");

        // Post page: voter management stays available to contributors.
        await contributorPage
          .getByRole("link", {
            name: `View ${title}`,
            exact: true,
          })
          .click();
        await expect(contributorPage.getByLabel("Post Title")).toHaveValue(
          title
        );
        await expect(
          contributorPage.getByRole("button", { name: "Add voter" })
        ).toBeVisible();
        // Dashboard author reassignment is manager+ only: the contributor
        // sees the author as static text, never a `Change author` trigger.
        await expect(
          contributorPage.getByRole("button", { name: /Change author/ })
        ).toHaveCount(0);

        // Comment composer: neither a status picker nor an author picker —
        // the options trigger renders only when at least one section does.
        await expect(
          contributorPage.getByRole("button", { name: "Comment options" })
        ).toHaveCount(0);

        // The owner on the same workspace sees every on-behalf surface.
        await page.goto(owner.organizationUrl);
        await page.getByRole("button", { name: "New post" }).click();
        const ownerDialog = page.getByRole("dialog", {
          name: "Create Post",
        });
        await expect(
          ownerDialog.getByRole("button", { name: /Post author/ })
        ).toBeVisible();
        await page.keyboard.press("Escape");
        await openPost(page, title);
        await expect(
          page.getByRole("button", { name: "Comment options" })
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: /Change author/ })
        ).toBeVisible();

        await assertNoPageErrors(contributorPage);
      } finally {
        await inviteeContext.close();
      }
    }
  );
});

test.describe("post author reassignment", () => {
  test(
    "reassigns a post author to a new customer and records provenance",
    { tag: "@critical" },
    async ({ page }) => {
      await createWorkspace(page);
      const title = `Reassign post ${randomUUID().slice(0, 8)}`;
      const customerName = newCustomerName();
      const customerEmail = newCustomerEmail();

      await createPost(page, title, "Post to exercise reassignment.");
      await dismissToast(page, "Post created successfully");
      await openPost(page, title);

      // The details sidebar offers the shared picker under `Change author`.
      await expect(
        page.getByRole("button", { name: /Change author/ })
      ).toBeVisible();
      await reassignAuthorThroughDialog(page, customerName, customerEmail);
      await dismissToast(page, "Author updated");

      // The trigger now displays the new author once collections refetch.
      await expect(
        page.getByRole("button", { name: new RegExp(customerName) })
      ).toBeVisible();

      await openActivityTab(page);
      await expect(
        activityItem(page, /changed the author/).filter({
          hasText: customerName,
        })
      ).toBeVisible();
      await expect(
        activityItem(page, /on behalf of/).filter({ hasText: customerName })
      ).toBeVisible();

      // Contact-only subjects are attribution-only: no email leaves.
      const emails = await getTestEmails(page.request);
      expect(
        emails.filter((email) => email.to.toLowerCase() === customerEmail)
      ).toHaveLength(0);
    }
  );

  test("reassigns a post author to an existing contact from search", async ({
    page,
  }) => {
    await createWorkspace(page);
    const customerName = newCustomerName();
    const customerEmail = newCustomerEmail();
    const title = `Reassign search ${randomUUID().slice(0, 8)}`;

    await createPost(page, title, "Post to exercise search reassignment.");
    await dismissToast(page, "Post created successfully");
    await openPost(page, title);
    // Seed the contact so the reassignment picker has a result row.
    await addVoterThroughDialog(page, customerName, customerEmail);
    await expect(page.getByText("Voters (1)")).toBeVisible();

    await reassignAuthorThroughSearch(page, customerEmail, customerName);
    await dismissToast(page, "Author updated");
    await expect(
      page.getByRole("button", { name: new RegExp(customerName) })
    ).toBeVisible();

    await openActivityTab(page);
    await expect(
      activityItem(page, /changed the author/).filter({
        hasText: customerName,
      })
    ).toBeVisible();
  });

  test("dashboard shows the contact name while the public board hides it", async ({
    browser,
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const title = `Author display ${randomUUID().slice(0, 8)}`;
    const customerName = newCustomerName();
    const customerEmail = newCustomerEmail();

    await createPostOnBehalfOfNewCustomer(
      page,
      title,
      "Contact-only author display.",
      customerEmail
    );
    await dismissToast(page, "Post created successfully");

    // Reassign the bare-email contact to a named customer (same email
    // enriches the existing contact) so the leak assertion targets a real
    // display name rather than a bare email.
    await openPost(page, title);
    await reassignAuthorThroughDialog(page, customerName, customerEmail);
    await dismissToast(page, "Author updated");
    await page.goto(owner.organizationUrl);
    // Dashboard rows fall back to the contact name when no user row is
    // linked, so the renamed author is visible on the dashboard card.
    // The card renders the name twice (mobile + desktop meta); target the
    // desktop slot, which is the visible one on the e2e viewport.
    const renamedCard = page
      .locator('[data-slot="post-card"]')
      .filter({ hasText: title });
    await expect(
      renamedCard.locator('[data-slot="post-card-author-name"]', {
        hasText: customerName,
      })
    ).toBeVisible();

    // Public rows never join the contact table: the customer name stays
    // off public boards even though the dashboard shows it.
    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    trackPageErrors(visitorPage);
    try {
      await visitorPage.goto(publicBoardUrl(owner.workspaceName));
      await expect(
        visitorPage.getByRole("link", { name: title })
      ).toBeVisible();
      await expect(visitorPage.getByText(customerName)).toHaveCount(0);
      await visitorPage.getByRole("link", { name: title }).click();
      await expect(visitorPage.getByText(title)).toBeVisible();
      await expect(visitorPage.getByText(customerName)).toHaveCount(0);
      await assertNoPageErrors(visitorPage);
    } finally {
      await visitorContext.close();
    }
  });
});

test.describe("picker guidance", () => {
  test("guides search input and offers create-new except on exact hits", async ({
    page,
  }) => {
    await createWorkspace(page);
    const customerName = newCustomerName();
    const customerEmail = newCustomerEmail();
    const seedTitle = `Guide seed ${randomUUID().slice(0, 8)}`;

    await createPost(page, seedTitle, "Seed.");
    await dismissToast(page, "Post created successfully");
    await openPost(page, seedTitle);
    await addVoterThroughDialog(page, customerName, customerEmail);

    // Reopen the voter picker to exercise its guidance states.
    await openAddVoterPopover(page);
    const input = page.getByRole("combobox", { name: "Add voter" });

    await input.click();
    await input.fill("x");
    await expect(
      page.getByText("Type at least 2 characters to search.")
    ).toBeVisible();

    await input.fill("");
    await expect(
      page.getByText("Type a name or email to search.")
    ).toBeVisible();

    // A near-miss email (valid, prefix of the stored address) shows both
    // the close row and the create-new entry.
    const nearMiss = customerEmail.slice(0, -1);
    await input.fill(nearMiss);
    await expect(
      page.getByRole("option").filter({ hasText: customerName })
    ).toBeVisible();
    await expect(
      page
        .getByRole("option")
        .filter({ hasText: nearMiss })
        .filter({ hasText: /as new customer/ })
    ).toBeVisible();

    // An exact email hit suppresses the create-new entry: submitting would
    // resolve to that contact anyway.
    await input.fill(customerEmail);
    await expect(
      page.getByRole("option").filter({ hasText: customerName })
    ).toBeVisible();
    await expect(
      page.getByRole("option").filter({ hasText: /as new customer/ })
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});

test.describe("public board", () => {
  test(
    "renders on-behalf comments under the customer's name",
    { tag: "@critical" },
    async ({ browser, page }) => {
      const owner = await createAuthenticatedWorkspace(page);
      const title = `Public on-behalf ${randomUUID().slice(0, 8)}`;
      const customerName = newCustomerName();
      const customerEmail = newCustomerEmail();
      const commentText = `Public hello ${randomUUID().slice(0, 8)}`;

      await createPost(page, title, "Post to exercise public rendering.");
      await dismissToast(page, "Post created successfully");
      await openPost(page, title);
      await addVoterThroughDialog(page, customerName, customerEmail);

      await page.getByRole("button", { name: "Comment options" }).click();
      await pickExistingContact(
        page,
        "Comment as customer",
        customerEmail,
        customerName
      );
      // Picking closes the popover but stages the subject in form state.
      await fillEditor(page, commentText, { scope: composerScope(page) });
      const created = waitForRpc(page, "CommentCreate");
      await page.getByRole("button", { name: "Comment Public" }).click();
      await created;
      await expect(commentCard(page, commentText)).toBeVisible();

      // Anonymous visitors read the subject as the author — the staff actor
      // never leaks onto the public surface.
      const visitorContext = await browser.newContext();
      const visitorPage = await visitorContext.newPage();
      trackPageErrors(visitorPage);
      try {
        await visitorPage.goto(publicBoardUrl(owner.workspaceName));
        await visitorPage.getByRole("link", { name: title }).click();
        await expect(visitorPage.getByText(commentText)).toBeVisible();
        await expect(visitorPage.getByText(customerName).first()).toBeVisible();
        await assertNoPageErrors(visitorPage);
      } finally {
        await visitorContext.close();
      }
    }
  );
});

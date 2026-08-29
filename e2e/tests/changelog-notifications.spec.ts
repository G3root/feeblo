import { randomUUID } from "node:crypto";

import { expect, type BrowserContext, type Page, test } from "@playwright/test";

import {
  createAuthenticatedWorkspace,
  signUpProgrammatically,
} from "../helpers/auth";
import { setPlan } from "../helpers/set-plan";
import {
  invitationIdFromEmail,
  waitForTestEmail,
} from "../helpers/test-mailbox";
import { createTestUser, type TestUser } from "../helpers/test-users";
import {
  copyWorkspaceJwtSecret,
  signInRestrictedSsoVisitor,
} from "../helpers/widget-sso";

const baseURL = process.env.E2E_BASE_URL ?? "http://localhost:3101";
const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const appOrigin = new URL(baseURL).origin;
const authDialogName = "Sign in / Sign up";
const signInWithEmailButtonName = /^Sign in with email/;

function publicBoardUrl(workspaceName: string) {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const url = new URL(baseURL);
  return `${url.protocol}//${subdomain}.${url.hostname}${url.port ? `:${url.port}` : ""}`;
}

function organizationIdFromUrl(organizationUrl: string): string {
  const organizationId = new URL(organizationUrl).pathname
    .split("/")
    .find(Boolean);
  if (!organizationId) {
    throw new Error("Workspace URL did not contain an organization id");
  }
  return organizationId;
}

async function openChangelogPage(page: Page, workspaceName: string) {
  await page.goto(`${publicBoardUrl(workspaceName)}/changelog`);
  await expect(
    page.getByRole("link", { name: "Subscribe to the changelog RSS feed" })
  ).toBeVisible();
}

async function publishChangelogEntry(
  page: Page,
  entry: { slug: string; title: string }
) {
  await page.getByRole("link", { name: "Changelog", exact: true }).click();
  await page.getByRole("button", { name: "New Entry" }).click();
  await page.getByLabel("Post Title").fill(entry.title);

  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText("Body for the notifications e2e test.");

  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: "Save changelog" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Slug").fill(entry.slug);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Changelog published")).toBeVisible();
}

/**
 * Signs an existing account in through the public-board auth dialog. The
 * dialog is either already open (triggered by the subscribe button while
 * signed out) or opened here through the navbar auth button; both start at
 * the method chooser.
 */
async function signInOnPublicBoard(page: Page, user: TestUser) {
  const authDialog = page.getByRole("dialog", { name: authDialogName });
  // Subscribe-triggered dialogs are already open; navbar-triggered ones need
  // a click. Wait briefly for the former before falling back to the latter.
  const alreadyOpen = await authDialog
    .waitFor({ state: "visible", timeout: 2_000 })
    .then(() => true)
    .catch(() => false);
  if (!alreadyOpen) {
    await page.getByRole("button", { name: authDialogName }).click();
  }
  await expect(authDialog).toBeVisible();

  await authDialog
    .getByRole("button", { name: signInWithEmailButtonName })
    .click();
  const signInDialog = page.getByRole("dialog", {
    name: "Sign in with email",
  });
  await signInDialog.getByRole("textbox", { name: "Email" }).fill(user.email);
  await signInDialog
    .getByLabel("Password", { exact: true })
    .fill(user.password);
  const signInResponse = page.waitForResponse(
    (response) =>
      response.url().includes("/api/auth/sign-in/email") &&
      response.request().method() === "POST"
  );
  await signInDialog
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  expect((await signInResponse).ok()).toBeTruthy();
  await expect(signInDialog).toBeHidden();
}

/** Signs the current board user out through the navbar user menu. */
async function signOutOnPublicBoard(page: Page) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(
    page.getByRole("button", { name: authDialogName })
  ).toBeVisible();
}

function notificationsBell(page: Page) {
  return page.getByRole("button", { name: "Notifications" });
}

function changelogNotificationItem(page: Page, entryTitle: string) {
  return page
    .getByRole("menuitem")
    .filter({ hasText: "New changelog entry" })
    .filter({ hasText: entryTitle });
}

async function openNotificationsMenu(page: Page) {
  await notificationsBell(page).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  return menu;
}

async function markAllNotificationsRead(page: Page) {
  const response = page.waitForResponse(
    (candidate) =>
      /\/rpc\/?$/.test(candidate.url()) &&
      candidate.request().method() === "POST" &&
      (candidate.request().postData() ?? "").includes(
        "NotificationMarkAllReadPublic"
      )
  );
  await page.getByRole("button", { name: "Mark all read" }).click();
  return response;
}

async function inviteMember(
  page: Page,
  organizationUrl: string,
  email: string
) {
  await page.goto(`${organizationUrl}/settings/members`);
  const form = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Invite email" }),
  });
  await form.getByRole("textbox", { name: "Invite email" }).fill(email);
  await form.getByRole("button", { name: "Invite" }).click();
  await expect(
    page.getByText("Invitation sent", { exact: true })
  ).toBeVisible();
}

async function acceptInvitation(context: BrowserContext, invitationId: string) {
  return context.request.post(
    `${apiURL}/api/auth/organization/accept-invitation`,
    {
      data: { invitationId },
      headers: { Origin: appOrigin },
    }
  );
}

test.describe("changelog notifications", () => {
  // A subscribed visitor receives an in-app notification when a workspace
  // member publishes a changelog entry. The bell, the inbox rows, and
  // mark-all-read all run through the new user-keyed *Public RPCs.
  test("notifies a subscribed visitor when an entry is published", async ({
    browser,
    page,
  }) => {
    const owner = createTestUser();
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    await createAuthenticatedWorkspace(ownerPage, owner);

    // The visitor is a regular end-user account with no workspace membership.
    const visitor = createTestUser();
    await signUpProgrammatically(page, visitor);

    const entry = {
      slug: `notify-${randomUUID().slice(0, 8)}`,
      title: `Notified changelog ${randomUUID().slice(0, 8)}`,
    };

    try {
      await openChangelogPage(page, owner.workspaceName);
      await page
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();

      // Publishing happens in the owner's separate session.
      await publishChangelogEntry(ownerPage, entry);

      // A fresh load picks up the notification created at publish time.
      await openChangelogPage(page, owner.workspaceName);
      await expect(notificationsBell(page)).toContainText("1");

      await openNotificationsMenu(page);
      const item = changelogNotificationItem(page, entry.title);
      await expect(item).toHaveCount(1);

      // "Mark all read" clears the unread badge and the read state survives
      // a reload.
      expect((await markAllNotificationsRead(page)).ok()).toBeTruthy();
      await expect(notificationsBell(page)).not.toContainText("1");

      await page.reload();
      await expect(notificationsBell(page)).not.toContainText("1");

      // The notification deep-links to the public changelog entry.
      await openNotificationsMenu(page);
      await item.click();
      await expect(page).toHaveURL(new RegExp(`/changelog/${entry.slug}`));
    } finally {
      await ownerContext.close();
    }
  });

  // Subscriptions are keyed by the session user, never by board or browser:
  // signing out and back in as someone else must not leak the previous
  // visitor's subscription state through a shared cache entry.
  test("keeps changelog subscription state per user on the board", async ({
    browser,
    page,
  }) => {
    const owner = createTestUser();
    await createAuthenticatedWorkspace(page, owner);

    // Each visitor account is signed up in its own fresh context (the
    // sign-up endpoint rejects cookie-bearing requests without an Origin
    // header), while the board flow runs in a separate cookie-free visitor
    // context that signs in through the auth dialog.
    const first = createTestUser();
    const second = createTestUser();
    const firstContext = await browser.newContext();
    const secondContext = await browser.newContext();
    const visitorContext = await browser.newContext();
    try {
      await signUpProgrammatically(await firstContext.newPage(), first);
      await signUpProgrammatically(await secondContext.newPage(), second);
      const visitorPage = await visitorContext.newPage();

      await openChangelogPage(visitorPage, owner.workspaceName);

      // Second visitor subscribes.
      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await signInOnPublicBoard(visitorPage, second);
      await openChangelogPage(visitorPage, owner.workspaceName);
      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await expect(
        visitorPage.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();

      // Signing back in as the first visitor starts unsubscribed.
      await signOutOnPublicBoard(visitorPage);
      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await signInOnPublicBoard(visitorPage, first);
      await openChangelogPage(visitorPage, owner.workspaceName);
      await expect(
        visitorPage.getByRole("button", { name: "Subscribe", exact: true })
      ).toBeVisible();

      // Subscribing as the first visitor never touches the second one's row.
      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await expect(
        visitorPage.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();

      // The second visitor's subscription persisted, per user.
      await signOutOnPublicBoard(visitorPage);
      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await signInOnPublicBoard(visitorPage, second);
      await openChangelogPage(visitorPage, owner.workspaceName);
      await expect(
        visitorPage.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();
    } finally {
      await firstContext.close();
      await secondContext.close();
      await visitorContext.close();
    }
  });

  // Members are notified through the same user-keyed inbox: a subscribed
  // member sees the publish notification in the dashboard bell and its href
  // routes to the dashboard changelog editor.
  test("notifies a subscribed member in the dashboard when a teammate publishes", async ({
    browser,
    page,
  }) => {
    const owner = createTestUser();
    const workspace = await createAuthenticatedWorkspace(page, owner);
    const organizationId = organizationIdFromUrl(workspace.organizationUrl);

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();
    const member = createTestUser();
    await signUpProgrammatically(memberPage, member);

    await inviteMember(page, workspace.organizationUrl, member.email);
    const invitationEmail = await waitForTestEmail(
      page.context().request,
      member.email
    );
    const accepted = await acceptInvitation(
      memberContext,
      invitationIdFromEmail(invitationEmail)
    );
    expect(accepted.ok()).toBeTruthy();

    try {
      // The owner subscribes on their own public board.
      await openChangelogPage(page, owner.workspaceName);
      await page
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();

      const entry = {
        slug: `member-notify-${randomUUID().slice(0, 8)}`,
        title: `Member publish ${randomUUID().slice(0, 8)}`,
      };
      await memberPage.goto(workspace.organizationUrl);
      await publishChangelogEntry(memberPage, entry);

      // The owner's dashboard bell picks the notification up.
      await page.goto(workspace.organizationUrl);
      await expect(notificationsBell(page)).toContainText("1");

      await openNotificationsMenu(page);
      const item = changelogNotificationItem(page, entry.title);
      await expect(item).toHaveCount(1);

      await item.click();
      await expect(page).toHaveURL(
        new RegExp(`/${organizationId}/changelog/edit/${entry.slug}`)
      );
    } finally {
      await memberContext.close();
    }
  });

  // Restricted SSO sessions (widget JWT auto-login) are admitted by the
  // PublicAuthMiddleware on the changelog-subscription and notification
  // Public RPCs, so an SSO end-user can subscribe and get notified like any
  // other signed-in visitor.
  test("restricted SSO visitor can subscribe and receive changelog notifications", async ({
    browser,
  }) => {
    const owner = createTestUser();
    const ownerContext = await browser.newContext();
    const ownerPage = await ownerContext.newPage();
    const workspace = await createAuthenticatedWorkspace(ownerPage, owner);
    const organizationId = organizationIdFromUrl(workspace.organizationUrl);

    // Widget SSO is a paid capability (Starter plan or higher).
    await setPlan(ownerPage.request, { organizationId, plan: "starter" });
    const secret = await copyWorkspaceJwtSecret(ownerPage, organizationId);

    const { context: visitorContext, page: visitorPage } =
      await signInRestrictedSsoVisitor(browser, {
        boardUrl: publicBoardUrl(owner.workspaceName),
        identity: {
          userId: `visitor-${randomUUID().slice(0, 12)}`,
          name: "Changelog SSO Visitor",
          email: `sso-notify-${randomUUID().slice(0, 12)}@feeblo.dev`,
        },
        organizationId,
        secret,
      });

    try {
      await visitorPage.goto(
        `${publicBoardUrl(owner.workspaceName)}/changelog`
      );
      await expect(
        visitorPage.getByRole("button", { name: "Subscribe", exact: true })
      ).toBeVisible();

      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await expect(
        visitorPage.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();

      // The subscription is persisted per user and survives a reload.
      await visitorPage.reload();
      await expect(
        visitorPage.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();

      const entry = {
        slug: `sso-notify-${randomUUID().slice(0, 8)}`,
        title: `SSO notified ${randomUUID().slice(0, 8)}`,
      };
      // Publishing happens from the dashboard; the owner page sits on the
      // security settings after the JWT secret setup, so go back first.
      await ownerPage.goto(workspace.organizationUrl);
      await publishChangelogEntry(ownerPage, entry);

      await visitorPage.reload();
      await expect(notificationsBell(visitorPage)).toContainText("1");

      await openNotificationsMenu(visitorPage);
      const item = changelogNotificationItem(visitorPage, entry.title);
      await expect(item).toHaveCount(1);

      expect((await markAllNotificationsRead(visitorPage)).ok()).toBeTruthy();
      await expect(notificationsBell(visitorPage)).not.toContainText("1");
    } finally {
      await visitorContext.close();
      await ownerContext.close();
    }
  });

  // The restricted-scope policy confines SSO sessions to their own
  // organization: a visitor restricted to workspace A must not be able to
  // subscribe to workspace B's changelog through the Public RPC.
  test("restricted SSO visitor cannot subscribe to another workspace's changelog", async ({
    browser,
  }) => {
    const ownerA = createTestUser();
    const ownerAContext = await browser.newContext();
    const ownerAPage = await ownerAContext.newPage();
    const workspaceA = await createAuthenticatedWorkspace(ownerAPage, ownerA);
    const organizationIdA = organizationIdFromUrl(workspaceA.organizationUrl);

    const ownerB = createTestUser();
    const ownerBContext = await browser.newContext();
    const ownerBPage = await ownerBContext.newPage();
    const workspaceB = await createAuthenticatedWorkspace(ownerBPage, ownerB);
    const organizationIdB = organizationIdFromUrl(workspaceB.organizationUrl);

    await setPlan(ownerAPage.request, {
      organizationId: organizationIdA,
      plan: "starter",
    });
    const secret = await copyWorkspaceJwtSecret(ownerAPage, organizationIdA);

    const { context: visitorContext, page: visitorPage } =
      await signInRestrictedSsoVisitor(browser, {
        boardUrl: publicBoardUrl(ownerA.workspaceName),
        identity: {
          userId: `visitor-${randomUUID().slice(0, 12)}`,
          name: "Cross Org SSO Visitor",
          email: `sso-cross-${randomUUID().slice(0, 12)}@feeblo.dev`,
        },
        organizationId: organizationIdA,
        secret,
      });

    try {
      // Subscribe on the visitor's own board first: allowed.
      await visitorPage.goto(
        `${publicBoardUrl(ownerA.workspaceName)}/changelog`
      );
      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await expect(
        visitorPage.getByRole("button", { name: "Unsubscribe", exact: true })
      ).toBeVisible();

      // Server-side backstop: the restricted-scope policy denies the create
      // (and list) Public RPCs for any organization other than the one the
      // session is restricted to. The request is issued from the visitor's
      // own board so the session cookie is still attached.
      const crossOrgResult = await visitorPage.evaluate(
        async ({ apiUrl, ownOrganizationId, foreignOrganizationId }) => {
          const request = (organizationId: string) =>
            fetch(`${apiUrl}/rpc`, {
              body: `${JSON.stringify({
                _tag: "Request",
                headers: [],
                id: 0,
                payload: { organizationId },
                tag: "ChangelogSubscriptionCreatePublic",
              })}\n`,
              credentials: "include",
              headers: { "content-type": "application/ndjson" },
              method: "POST",
            }).then(async (response) => ({
              body: await response.text(),
              status: response.status,
            }));

          // SAFETY: the RPC endpoint always answers with a single NDJSON
          // Exit envelope per line, so the response text parses to it.
          const foreign = await request(foreignOrganizationId);
          const own = await request(ownOrganizationId);
          return { foreign, own };
        },
        {
          apiUrl: apiURL,
          foreignOrganizationId: organizationIdB,
          ownOrganizationId: organizationIdA,
        }
      );

      // SAFETY: the RPC endpoint always answers with a single NDJSON Exit
      // envelope, so the response text parses to it.
      const foreignExit = JSON.parse(crossOrgResult.foreign.body.trim()) as {
        exit: { _tag: string; cause?: unknown };
      };
      expect(foreignExit.exit._tag).toBe("Failure");

      // Control: the same call for the visitor's own organization succeeds.
      // SAFETY: the RPC endpoint always answers with a single NDJSON Exit
      // envelope, so the response text parses to it.
      const ownExit = JSON.parse(crossOrgResult.own.body.trim()) as {
        exit: { _tag: string };
      };
      expect(ownExit.exit._tag).toBe("Success");

      // UI-level guard: landing on workspace B's board terminates the
      // mismatched restricted session, so subscribing falls back to the
      // signed-out auth flow instead of touching workspace B.
      await visitorPage.goto(
        `${publicBoardUrl(ownerB.workspaceName)}/changelog`
      );
      await visitorPage
        .getByRole("button", { name: "Subscribe", exact: true })
        .click();
      await expect(
        visitorPage.getByRole("dialog", { name: authDialogName })
      ).toBeVisible();
      await visitorPage
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await visitorPage.reload();
      await expect(
        visitorPage.getByRole("button", { name: "Subscribe", exact: true })
      ).toBeVisible();
    } finally {
      await visitorContext.close();
      await ownerAContext.close();
      await ownerBContext.close();
    }
  });
});

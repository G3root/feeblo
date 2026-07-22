import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import {
  createAuthenticatedWorkspace,
  signUpProgrammatically,
} from "../helpers/auth";
import {
  getTestEmails,
  invitationIdFromEmail,
  waitForTestEmail,
} from "../helpers/test-mailbox";
import { createTestUser, type TestUser } from "../helpers/test-users";

const apiURL = process.env.E2E_API_URL ?? "http://localhost:3100";
const appOrigin = new URL(
  process.env.E2E_BASE_URL ?? "http://localhost:3101"
).origin;

const invitationEndpoint = (action: "accept" | "reject") =>
  `${apiURL}/api/auth/organization/${action}-invitation`;

function membersUrl(organizationUrl: string): string {
  return `${organizationUrl}/settings/members`;
}

async function inviteMember(
  page: Page,
  email: string,
  role: "admin" | "member" = "member",
  expectSuccess = true
) {
  const form = page.locator("form").filter({
    has: page.getByRole("textbox", { name: "Invite email" }),
  });

  await form.getByRole("textbox", { name: "Invite email" }).fill(email);
  if (role !== "member") {
    await form.getByRole("combobox").click();
    await page.getByRole("option", { name: "Admin" }).click();
  }
  await form.getByRole("button", { name: "Invite" }).click();
  if (expectSuccess) {
    await expect(
      page.getByText("Invitation sent", { exact: true })
    ).toBeVisible();
  }
}

async function createSignedInUser(
  context: BrowserContext,
  user: TestUser
): Promise<Page> {
  const page = await context.newPage();
  await signUpProgrammatically(page, user);
  return page;
}

function respondToInvitation(
  context: BrowserContext,
  invitationId: string,
  action: "accept" | "reject"
) {
  return context.request.post(invitationEndpoint(action), {
    data: { invitationId },
    headers: { Origin: appOrigin },
  });
}

test.describe("member invitations", () => {
  test("owner sends a member invitation through the real test mailer", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invitee = createTestUser();

    await page.goto(membersUrl(owner.organizationUrl));
    await inviteMember(page, invitee.email);

    await expect(
      page.getByText("Invitation sent", { exact: true })
    ).toBeVisible();
    await expect(page.getByText(invitee.email, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Invited as member", { exact: true })
    ).toBeVisible();

    const email = await waitForTestEmail(page.context().request, invitee.email);
    expect(email.subject).toBe(`Join ${owner.workspaceName} on Feeblo`);
    expect(email.text).toContain(owner.workspaceName);
    expect(email.text).toContain("Role");
    expect(email.text).toContain("member");
    expect(email.html).toContain(
      `${new URL(owner.organizationUrl).origin}/invitation/`
    );
  });

  test("owner can invite an admin", async ({ page }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invitee = createTestUser();

    await page.goto(membersUrl(owner.organizationUrl));
    await inviteMember(page, invitee.email, "admin");

    await expect(page.getByText(invitee.email, { exact: true })).toBeVisible();
    await expect(
      page.getByText("Invited as admin", { exact: true })
    ).toBeVisible();

    const email = await waitForTestEmail(page.context().request, invitee.email);
    expect(email.text).toContain("admin");
  });

  test("invite form rejects an invalid email without sending mail", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invalidEmail = "not-an-email";

    await page.goto(membersUrl(owner.organizationUrl));
    await inviteMember(page, invalidEmail, "member", false);

    expect(
      await page
        .getByRole("textbox", { name: "Invite email" })
        .evaluate(
          (input) =>
            "checkValidity" in input &&
            typeof input.checkValidity === "function" &&
            !input.checkValidity()
        )
    ).toBeTruthy();
    const emails = await getTestEmails(page.context().request);
    expect(emails.filter((email) => email.to === invalidEmail)).toHaveLength(0);
  });

  test("duplicate pending invitation is rejected and does not resend mail", async ({
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invitee = createTestUser();

    await page.goto(membersUrl(owner.organizationUrl));
    await inviteMember(page, invitee.email);
    await waitForTestEmail(page.context().request, invitee.email);
    await expect(
      page.getByRole("textbox", { name: "Invite email" })
    ).toBeEmpty();
    await inviteMember(page, invitee.email, "member", false);

    await expect(
      page.getByText("Failed to invite member", { exact: true })
    ).toBeVisible();
    const emails = await getTestEmails(page.context().request);
    expect(emails.filter((email) => email.to === invitee.email)).toHaveLength(
      1
    );
  });

  test("only the invited account can accept an invitation", async ({
    browser,
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invitee = createTestUser();
    const otherUser = createTestUser();
    const inviteeContext = await browser.newContext();
    const otherContext = await browser.newContext();

    try {
      const inviteePage = await createSignedInUser(inviteeContext, invitee);
      await createSignedInUser(otherContext, otherUser);

      await page.goto(membersUrl(owner.organizationUrl));
      await inviteMember(page, invitee.email);
      const email = await waitForTestEmail(
        page.context().request,
        invitee.email
      );
      const invitationId = invitationIdFromEmail(email);

      const forbidden = await respondToInvitation(
        otherContext,
        invitationId,
        "accept"
      );
      expect(forbidden.status()).toBe(403);

      const accepted = await respondToInvitation(
        inviteeContext,
        invitationId,
        "accept"
      );
      expect(accepted.ok()).toBeTruthy();

      await page.reload();
      await expect(
        page.getByText(invitee.email, { exact: true })
      ).toBeVisible();
      await expect(page.getByText(invitee.name, { exact: true })).toBeVisible();

      await inviteePage.goto(owner.organizationUrl);
      await expect(
        inviteePage.getByRole("button", { name: invitee.email })
      ).toBeVisible();
    } finally {
      await inviteeContext.close();
      await otherContext.close();
    }
  });

  test("recipient can reject an invitation without becoming a member", async ({
    browser,
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invitee = createTestUser();
    const inviteeContext = await browser.newContext();

    try {
      await createSignedInUser(inviteeContext, invitee);
      await page.goto(membersUrl(owner.organizationUrl));
      await inviteMember(page, invitee.email);
      const email = await waitForTestEmail(
        page.context().request,
        invitee.email
      );

      const rejected = await respondToInvitation(
        inviteeContext,
        invitationIdFromEmail(email),
        "reject"
      );
      expect(rejected.ok()).toBeTruthy();

      await page.reload();
      await expect(page.getByText(invitee.email, { exact: true })).toHaveCount(
        0
      );
    } finally {
      await inviteeContext.close();
    }
  });

  test("revoked invitation can no longer be accepted", async ({
    browser,
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invitee = createTestUser();
    const inviteeContext = await browser.newContext();

    try {
      await createSignedInUser(inviteeContext, invitee);
      await page.goto(membersUrl(owner.organizationUrl));
      await inviteMember(page, invitee.email);
      const email = await waitForTestEmail(
        page.context().request,
        invitee.email
      );

      const invitationRow = page
        .getByText(invitee.email, { exact: true })
        .locator("..")
        .locator("..");
      await invitationRow.getByRole("button").click();
      await expect(
        page.getByText("Invitation revoked", { exact: true })
      ).toBeVisible();
      await expect(page.getByText(invitee.email, { exact: true })).toHaveCount(
        0
      );

      const accepted = await respondToInvitation(
        inviteeContext,
        invitationIdFromEmail(email),
        "accept"
      );
      expect(accepted.ok()).toBeFalsy();
    } finally {
      await inviteeContext.close();
    }
  });

  test("a member cannot invite teammates", async ({
    browser,
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const member = createTestUser();
    const memberContext = await browser.newContext();

    try {
      const memberPage = await createSignedInUser(memberContext, member);
      await page.goto(membersUrl(owner.organizationUrl));

      await inviteMember(page, member.email);
      const memberEmail = await waitForTestEmail(
        page.context().request,
        member.email
      );
      expect(
        (
          await respondToInvitation(
            memberContext,
            invitationIdFromEmail(memberEmail),
            "accept"
          )
        ).ok()
      ).toBeTruthy();

      await memberPage.goto(membersUrl(owner.organizationUrl));
      await expect(
        memberPage.getByRole("textbox", { name: "Invite email" })
      ).toHaveCount(0);
    } finally {
      await memberContext.close();
    }
  });

  test("an admin can invite teammates", async ({ browser, page }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const admin = createTestUser();
    const adminContext = await browser.newContext();

    try {
      const adminPage = await createSignedInUser(adminContext, admin);
      await page.goto(membersUrl(owner.organizationUrl));

      await inviteMember(page, admin.email, "admin");
      const adminEmail = await waitForTestEmail(
        page.context().request,
        admin.email
      );
      expect(
        (
          await respondToInvitation(
            adminContext,
            invitationIdFromEmail(adminEmail),
            "accept"
          )
        ).ok()
      ).toBeTruthy();

      await adminPage.goto(membersUrl(owner.organizationUrl));
      await expect(
        adminPage.getByRole("textbox", { name: "Invite email" })
      ).toBeVisible();
    } finally {
      await adminContext.close();
    }
  });

  test("an existing member cannot be invited again", async ({
    browser,
    page,
  }) => {
    const owner = await createAuthenticatedWorkspace(page);
    const invitee = createTestUser();
    const inviteeContext = await browser.newContext();

    try {
      await createSignedInUser(inviteeContext, invitee);
      await page.goto(membersUrl(owner.organizationUrl));
      await inviteMember(page, invitee.email);
      const firstEmail = await waitForTestEmail(
        page.context().request,
        invitee.email
      );
      expect(
        (
          await respondToInvitation(
            inviteeContext,
            invitationIdFromEmail(firstEmail),
            "accept"
          )
        ).ok()
      ).toBeTruthy();

      await page.reload();
      await inviteMember(page, invitee.email, "member", false);
      await expect(
        page.getByText("Failed to invite member", { exact: true })
      ).toBeVisible();

      const emails = await getTestEmails(page.context().request);
      expect(
        emails.filter(
          (email) =>
            email.to === invitee.email && email.html.includes("/invitation/")
        )
      ).toHaveLength(1);
    } finally {
      await inviteeContext.close();
    }
  });
});

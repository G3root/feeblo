import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createAuthenticatedWorkspace, logOut } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

const signInWithEmailButtonName = /^Sign in with email/;
const authDialogName = "Sign in / Sign up";

function publicBoardUrl(workspaceName: string) {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const baseURL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101");
  return `${baseURL.protocol}//${subdomain}.${baseURL.hostname}${baseURL.port ? `:${baseURL.port}` : ""}`;
}

async function openChangelogPage(page: Page, workspaceName: string) {
  await page.goto(`${publicBoardUrl(workspaceName)}/changelog`);
  await expect(
    page.getByRole("link", { name: "Subscribe to the changelog RSS feed" })
  ).toBeVisible();
}

test.describe("changelog email subscription", () => {
  // Subscribing is available on every plan — only subscriber email delivery
  // is paid-gated server-side.
  test("lets a signed-in visitor subscribe on the free plan", async ({
    page,
  }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);
    // Workspace creation authenticates the owner. Start this scenario as a
    // signed-out public visitor so it exercises the auth-gated toggle before
    // signing back in.
    await logOut(page, user.email);

    await openChangelogPage(page, user.workspaceName);

    // Signed-out visitors are asked to sign in first.
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    const authDialog = page.getByRole("dialog", { name: authDialogName });
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
    // The auth dialog returns to the public board root. Re-open the changelog
    // before asserting the authenticated subscription control.
    await openChangelogPage(page, user.workspaceName);

    // Wait for the optimistic toggle to persist before exercising the
    // opposite direction: the button swallows clicks while a mutation is in
    // flight, so a fast follow-up click would otherwise be dropped.
    const subscribeResponse = page.waitForResponse(
      (response) =>
        /\/rpc\/?$/.test(response.url()) &&
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(
          "ChangelogSubscriptionCreatePublic"
        )
    );
    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    expect((await subscribeResponse).ok()).toBeTruthy();
    // The anchored success toast is only added once persistence has fully
    // settled, so it also guarantees the button's re-entrancy guard is clear
    // before the opposite toggle is clicked.
    await expect(page.getByText("Subscribed to the changelog!")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Unsubscribe", exact: true })
    ).toBeVisible();

    // Unsubscribe again and confirm the choice survives a reload.
    const unsubscribeResponse = page.waitForResponse(
      (response) =>
        /\/rpc\/?$/.test(response.url()) &&
        response.request().method() === "POST" &&
        (response.request().postData() ?? "").includes(
          "ChangelogSubscriptionDeletePublic"
        )
    );
    await page
      .getByRole("button", { name: "Unsubscribe", exact: true })
      .click();
    expect((await unsubscribeResponse).ok()).toBeTruthy();

    await page.reload();
    await expect(
      page.getByRole("button", { name: "Subscribe", exact: true })
    ).toBeVisible();
  });

  test("shows the subscribe button on a changelog entry page", async ({
    page,
  }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);
    const title = `Subscribe changelog ${randomUUID().slice(0, 8)}`;
    const slug = `subscribe-${randomUUID().slice(0, 8)}`;

    // Publish one entry so the detail page exists.
    await page.getByRole("link", { name: "Changelog", exact: true }).click();
    await page.getByRole("button", { name: "New Entry" }).click();
    await page.getByLabel("Post Title").fill(title);
    const editor = page.locator(".ProseMirror");
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.insertText("Entry for the subscription e2e test.");
    await page.getByRole("button", { name: "Publish", exact: true }).click();
    const dialog = page.getByRole("alertdialog", { name: "Save changelog" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Slug").fill(slug);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await expect(dialog).toBeHidden();

    await openChangelogPage(page, user.workspaceName);
    await page.getByRole("link", { name: title }).click();

    await expect(
      page.getByRole("button", { name: "Subscribe", exact: true })
    ).toBeVisible();
  });
});

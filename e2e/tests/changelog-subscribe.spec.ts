import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
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

    await page.getByRole("button", { name: "Subscribe", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Unsubscribe", exact: true })
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

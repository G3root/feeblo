import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

async function createPost(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "New post" }).click();

  const dialog = page.getByRole("dialog", { name: "Create Post" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Post Title").fill(title);

  // The rich-text editor currently has no accessible name, so scope this
  // implementation-level locator to the create-post dialog only.
  const editor = dialog.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.fill(content);

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Features 💡" }).click();
  await dialog.getByRole("button", { name: "Create Post" }).click();
  await expect(dialog).toBeHidden();
}

function publicBoardUrl(workspaceName: string) {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const baseURL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101");
  return `${baseURL.protocol}//${subdomain}.${baseURL.hostname}${baseURL.port ? `:${baseURL.port}` : ""}`;
}

test(
  "visitors can browse public feedback and cannot vote anonymously",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const title = `Public feedback ${randomUUID().slice(0, 8)}`;
    const content = "Visitors should be able to read this feedback.";
    await createPost(page, title, content);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      await visitorPage.goto(publicBoardUrl(user.workspaceName));

      const feedbackLink = visitorPage.getByRole("link", { name: title });
      await expect(feedbackLink).toBeVisible();
      await feedbackLink.click();

      await expect(visitorPage.getByText(content)).toBeVisible();
      await expect(
        visitorPage.getByRole("link", { name: "Features 💡", exact: true })
      ).toBeVisible();

      const upvoteButton = visitorPage.getByRole("button", {
        name: "Upvote",
      });
      await expect(upvoteButton).toContainText("0");
      await upvoteButton.click();

      const authDialogHeading = visitorPage.getByRole("heading", {
        name: "Continue to Feeblo",
      });
      await expect(authDialogHeading).toBeVisible();
      await visitorPage.keyboard.press("Escape");
      await expect(authDialogHeading).toBeHidden();
      await expect(upvoteButton).toContainText("0");

      await visitorPage.getByRole("button", { name: "Add reaction" }).click();
      await visitorPage.getByRole("button", { name: "👍️" }).click();
      await expect(authDialogHeading).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  }
);

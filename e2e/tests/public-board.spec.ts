import { randomUUID } from "node:crypto";
import { expect, type Page, test } from "@playwright/test";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import {
  verificationCodeFromEmail,
  waitForVerificationEmail,
} from "../helpers/test-mailbox";
import { createTestUser } from "../helpers/test-users";

const signInWithEmailButtonName = /^Sign in with email/;
const signUpWithEmailButtonName = /^Sign up with email/;

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

async function signInThroughPublicBoard(
  page: Page,
  email: string,
  password: string
) {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  const authDialog = page.getByRole("dialog", { name: "Continue to Feeblo" });
  await expect(authDialog).toBeVisible();
  await authDialog
    .getByRole("button", { name: signInWithEmailButtonName })
    .click();

  const signInDialog = page.getByRole("dialog", { name: "Sign in with email" });
  await signInDialog.getByRole("textbox", { name: "Email" }).fill(email);
  await signInDialog.getByLabel("Password", { exact: true }).fill(password);

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
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

test(
  "public board sign-in grants authenticated actions and sign-out revokes them",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      await visitorPage.goto(publicBoardUrl(user.workspaceName));
      await signInThroughPublicBoard(visitorPage, user.email, user.password);

      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      await expect(
        visitorPage.getByRole("dialog", { name: "Create Post" })
      ).toBeVisible();
      await visitorPage.keyboard.press("Escape");

      await visitorPage.getByRole("button", { name: "Sign out" }).click();
      await expect(
        visitorPage.getByRole("button", { name: "Sign in", exact: true })
      ).toBeVisible();

      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      await expect(
        visitorPage.getByRole("dialog", { name: "Continue to Feeblo" })
      ).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  }
);

test(
  "visitor can sign up from a public board and gain public write access",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const owner = createTestUser();
    const visitor = createTestUser();
    await createAuthenticatedWorkspace(page, owner);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      const boardUrl = publicBoardUrl(owner.workspaceName);
      await visitorPage.goto(boardUrl);
      await visitorPage
        .getByRole("button", { name: "Sign up", exact: true })
        .click();

      const chooserDialog = visitorPage.getByRole("dialog", {
        name: "Continue to Feeblo",
      });
      await chooserDialog
        .getByRole("button", { name: signUpWithEmailButtonName })
        .click();

      const signUpDialog = visitorPage.getByRole("dialog", {
        name: "Sign up with email",
      });
      await signUpDialog
        .getByRole("textbox", { name: "Full name" })
        .fill(visitor.name);
      await signUpDialog
        .getByRole("textbox", { name: "Email" })
        .fill(visitor.email);
      await signUpDialog
        .getByLabel("Password", { exact: true })
        .fill(visitor.password);
      await signUpDialog
        .getByLabel("Confirm password", { exact: true })
        .fill(visitor.password);
      await signUpDialog
        .getByRole("button", { name: "Sign up", exact: true })
        .click();

      const verificationDialog = visitorPage.getByRole("dialog", {
        name: "Verify your email",
      });
      await expect(verificationDialog).toBeVisible();
      await verificationDialog
        .getByRole("button", { name: "Resend", exact: true })
        .click();

      const email = await waitForVerificationEmail(
        visitorPage.request,
        visitor.email
      );
      await verificationDialog
        .getByRole("textbox")
        .fill(verificationCodeFromEmail(email));
      await verificationDialog
        .getByRole("button", { name: "Verify", exact: true })
        .click();

      await expect(visitorPage).toHaveURL(boardUrl);
      await expect(
        visitorPage.getByRole("button", { name: "Sign out" })
      ).toBeVisible();
      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      await expect(
        visitorPage.getByRole("dialog", { name: "Create Post" })
      ).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  }
);

test(
  "anonymous visitors are denied every public board write capability",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const title = `Protected feedback ${randomUUID().slice(0, 8)}`;
    await createPost(page, title, "Every write action requires a session.");

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      await visitorPage.goto(publicBoardUrl(user.workspaceName));

      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      const authDialog = visitorPage.getByRole("dialog", {
        name: "Continue to Feeblo",
      });
      await expect(authDialog).toBeVisible();
      await visitorPage.keyboard.press("Escape");
      await expect(
        visitorPage.getByRole("dialog", { name: "Create Post" })
      ).toBeHidden();

      await visitorPage.getByRole("link", { name: title }).click();
      await expect(
        visitorPage.getByText(
          "Sign in to leave a comment or react to this post."
        )
      ).toBeVisible();
      await expect(
        visitorPage.getByRole("button", { name: "Comment Public" })
      ).toBeDisabled();
      await expect(
        visitorPage.getByRole("button", { name: "Switch to internal" })
      ).toBeDisabled();

      await visitorPage
        .getByRole("button", { name: "Sign in", exact: true })
        .last()
        .click();
      await expect(authDialog).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  }
);

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

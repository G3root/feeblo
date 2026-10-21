import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "../fixtures";
import { createAuthenticatedWorkspace } from "../helpers/auth";
import { waitForHydration } from "../helpers/hydration";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { createPost, fillEditor, openPost } from "../helpers/posts";
import {
  verificationCodeFromEmail,
  waitForVerificationEmail,
} from "../helpers/test-mailbox";
import { createTestUser } from "../helpers/test-users";
import { publicBoardUrl } from "../helpers/urls";

const signInWithEmailButtonName = /^Sign in with email/;
const signUpWithEmailButtonName = /^Sign up with email/;
const authDialogName = "Sign in / Sign up";
const authButtonName = "Sign in / Sign up";

async function signInThroughPublicBoard(
  page: Page,
  email: string,
  password: string
) {
  await page.getByRole("button", { name: authButtonName }).click();

  const authDialog = page.getByRole("dialog", { name: authDialogName });
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
  await expect(page.getByRole("button", { name: authButtonName })).toHaveCount(
    0
  );
  // Authenticated: user menu should be visible
  await expect(page.getByRole("button", { name: "User menu" })).toBeVisible();
}

async function signOutFromPublicBoard(page: Page) {
  await page.getByRole("button", { name: "User menu" }).click();
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await expect(
    page.getByRole("button", { name: authButtonName })
  ).toBeVisible();
}

/**
 * Adds a public comment on the dashboard post page. The composer's submit
 * button reads "Comment Public" while the visibility toggle is on PUBLIC.
 */
async function addPublicComment(page: Page, content: string) {
  const composer = page.locator('[data-slot="comment-composer"]');
  await fillEditor(page, content, { scope: composer });
  await page.getByRole("button", { name: "Comment Public" }).click();
  await expect(
    page.locator('[data-slot="comment"]').filter({ hasText: content }).first()
  ).toBeVisible();
}

test.beforeEach(({ page }) => {
  trackPageErrors(page);
});

test.afterEach(async ({ page }) => {
  await assertNoPageErrors(page);
});

test(
  "visitors can sign in from the sign-in page on a public board subdomain",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      const boardUrl = publicBoardUrl(user.workspaceName);
      const signInUrl = `${boardUrl}/sign-in`;

      // Auth pages render on the public board subdomain instead of the board's
      // not-found page, so a visitor can sign in without leaving the board.
      await visitorPage.goto(signInUrl);
      await expect(
        visitorPage.getByRole("textbox", { name: "Email" })
      ).toBeVisible();
      await expect(
        visitorPage.getByText("Enter your account credentials to continue.")
      ).toBeVisible();

      await visitorPage
        .getByRole("textbox", { name: "Email" })
        .fill(user.email);
      await visitorPage
        .getByRole("textbox", { name: "Password", exact: true })
        .fill(user.password);

      const signInResponse = visitorPage.waitForResponse(
        (response) =>
          response.url().includes("/api/auth/sign-in/email") &&
          response.request().method() === "POST"
      );
      await visitorPage
        .getByRole("button", { name: "Login", exact: true })
        .click();
      expect((await signInResponse).ok()).toBeTruthy();

      // Signing in from the public board lands the visitor back on the board
      // root, now authenticated.
      await expect(visitorPage).toHaveURL(`${boardUrl}/`);
      await expect(
        visitorPage.getByRole("button", { name: "User menu" })
      ).toBeVisible();
      await expect(
        visitorPage.getByRole("button", { name: authButtonName })
      ).toHaveCount(0);
    } finally {
      await visitorContext.close();
    }
  }
);

test(
  "a signed-in visitor can submit feedback from the public board",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    // Submitting through the public dialog exercises the public create
    // path end to end (shared optimistic form → `CreatePostPublic`), as
    // opposed to the dashboard dialog covered by the feedback specs.
    const title = `Visitor feedback ${randomUUID().slice(0, 8)}`;
    const content = "Submitted from the public board dialog.";
    const boardUrl = publicBoardUrl(user.workspaceName);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    trackPageErrors(visitorPage);

    try {
      await visitorPage.goto(boardUrl);
      await waitForHydration(visitorPage);
      await signInThroughPublicBoard(visitorPage, user.email, user.password);

      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      const dialog = visitorPage.getByRole("dialog", {
        name: "Create Post",
      });
      await expect(dialog).toBeVisible();

      await dialog.getByLabel("Post Title").fill(title);
      await fillEditor(visitorPage, content, { scope: dialog });
      await dialog.getByRole("combobox").first().click();
      await visitorPage.getByRole("option", { name: "Features 💡" }).click();

      await dialog.getByRole("button", { name: "Create Post" }).click();
      await expect(dialog).toBeHidden();

      await expect(
        visitorPage.getByRole("link", { name: `View ${title}`, exact: true })
      ).toBeVisible();
      await assertNoPageErrors(visitorPage);
    } finally {
      await visitorContext.close();
    }
  }
);

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
      await waitForHydration(visitorPage);
      await signInThroughPublicBoard(visitorPage, user.email, user.password);

      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      await expect(
        visitorPage.getByRole("dialog", { name: "Create Post" })
      ).toBeVisible();
      await visitorPage.keyboard.press("Escape");

      await signOutFromPublicBoard(visitorPage);

      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      await expect(
        visitorPage.getByRole("dialog", { name: authDialogName })
      ).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  }
);

test(
  "user can verify their email with the emailed code",
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
      await waitForHydration(visitorPage);
      await visitorPage.getByRole("button", { name: authButtonName }).click();

      const chooserDialog = visitorPage.getByRole("dialog", {
        name: authDialogName,
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
        .getByLabel("Confirm Password", { exact: true })
        .fill(visitor.password);
      await signUpDialog
        .getByRole("button", { name: "Sign up", exact: true })
        .click();

      const verificationDialog = visitorPage.getByRole("dialog", {
        name: "Verify your email",
      });
      await expect(verificationDialog).toBeVisible();

      const email = await waitForVerificationEmail(
        visitorPage.request,
        visitor.email
      );
      await verificationDialog
        .locator("#otp")
        .fill(verificationCodeFromEmail(email));
      await verificationDialog
        .getByRole("button", { name: "Verify", exact: true })
        .click();

      await expect(visitorPage).toHaveURL(`${boardUrl}/`);
      await expect(
        visitorPage.getByRole("button", { name: "User menu" })
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
      await waitForHydration(visitorPage);

      await visitorPage.getByRole("button", { name: "Give Feedback" }).click();
      const authDialog = visitorPage.getByRole("dialog", {
        name: authDialogName,
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
      ).toHaveCount(0);

      await visitorPage
        .getByRole("button", { name: authButtonName })
        .first()
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
      await waitForHydration(visitorPage);

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
        name: authDialogName,
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

test("the board document language follows the locale cookie before hydration", async ({
  browser,
  page,
}) => {
  const user = createTestUser();
  await createAuthenticatedWorkspace(page, user);

  const boardUrl = publicBoardUrl(user.workspaceName);
  const visitorContext = await browser.newContext();
  await visitorContext.addCookies([
    { name: "PARAGLIDE_LOCALE", value: "de", url: boardUrl },
  ]);
  const visitorPage = await visitorContext.newPage();

  try {
    // `<html lang dir>` is written both by the inline head script and, after
    // hydration, by the island. Blocking the island's JS proves the inline
    // script applied the cookie locale before first paint instead of flipping
    // it once the SPA boots.
    await visitorPage.route("**/*.js", (route) => route.abort());
    await visitorPage.goto(boardUrl, { waitUntil: "domcontentloaded" });

    await expect(visitorPage.locator("html")).toHaveAttribute("lang", "de");
    await expect(visitorPage.locator("html")).toHaveAttribute("dir", "ltr");
  } finally {
    await visitorContext.close();
  }
});

test(
  "a signed-in visitor keeps the board's own sign-in page",
  { tag: "@critical" },
  async ({ browser, page }) => {
    // Board hosts serve the auth pages themselves, and the dashboard's
    // `/{organizationId}` paths do not exist on a board host: redirecting there
    // lands on the board's not-found page. `authPageBeforeLoad` skips the
    // redirect off the app subdomain, and the post-hydration half
    // (`AuthPageRedirect`) has to make the same call — this holds the page open
    // past the session resolution, which is when that half would fire.
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);
    const boardUrl = publicBoardUrl(user.workspaceName);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();

    try {
      await visitorPage.goto(boardUrl);
      await waitForHydration(visitorPage);
      await signInThroughPublicBoard(visitorPage, user.email, user.password);

      await visitorPage.goto(`${boardUrl}/sign-in`);
      await waitForHydration(visitorPage);
      await visitorPage.waitForTimeout(2000);

      await expect(visitorPage).toHaveURL(`${boardUrl}/sign-in`);
      await expect(
        visitorPage.getByRole("textbox", { name: "Email" })
      ).toBeVisible();
    } finally {
      await visitorContext.close();
    }
  }
);

test("a signed-in visitor never paints the sign-in button while the session resolves", async ({
  browser,
  page,
}) => {
  const user = createTestUser();
  await createAuthenticatedWorkspace(page, user);
  const boardUrl = publicBoardUrl(user.workspaceName);

  const visitorContext = await browser.newContext();
  const visitorPage = await visitorContext.newPage();

  try {
    // Sign in once so the board host holds both the session and the
    // display-only hint cookie the pre-hydration script reads.
    await visitorPage.goto(boardUrl);
    await waitForHydration(visitorPage);
    await signInThroughPublicBoard(visitorPage, user.email, user.password);

    // With the app's JS blocked, only the server document and the inline
    // pre-hydration scripts remain: what is painted then is the anti-flash
    // contract. The document still contains the anonymous button, but the
    // hint cookie already says otherwise, so the button must not be the
    // thing that paints.
    await visitorPage.route("**/*.js", (route) => route.abort());
    await visitorPage.goto(boardUrl, { waitUntil: "domcontentloaded" });

    await expect(visitorPage.locator("html")).toHaveAttribute(
      "data-auth",
      "hint"
    );
    await expect(
      visitorPage.getByRole("button", { name: authButtonName })
    ).toBeHidden();
    await expect(
      visitorPage.locator('[data-auth-slot="account"]')
    ).toBeVisible();

    // Now with the app running but the session probe held open: the hint
    // has to carry the navbar through the in-flight request, and the probe's
    // late answer must not flip the rendered result.
    await visitorPage.unroute("**/*.js");
    let releaseProbe!: () => void;
    const probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve;
    });
    await visitorPage.route("**/api/auth/get-session**", async (route) => {
      await probeGate;
      await route.continue();
    });
    await visitorPage.goto(boardUrl);
    await waitForHydration(visitorPage);

    await expect(
      visitorPage.getByRole("button", { name: "User menu" })
    ).toBeVisible();
    await expect(
      visitorPage.getByRole("button", { name: authButtonName })
    ).toBeHidden();

    releaseProbe();
    await expect(
      visitorPage.getByRole("button", { name: "User menu" })
    ).toBeVisible();
    await expect(
      visitorPage.getByRole("button", { name: authButtonName })
    ).toBeHidden();

    // Only the fragment-derived `exchanging` marker is cleared; a hint from
    // the cookie still describes the document.
    await expect(visitorPage.locator("html")).toHaveAttribute(
      "data-auth",
      "hint"
    );
  } finally {
    await visitorContext.close();
  }
});

test(
  "board navigation stays on the board",
  { tag: "@critical" },
  async ({ browser, page }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const title = `Navigation post ${randomUUID().slice(0, 8)}`;
    await createPost(page, title, "Navigation body.");

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    trackPageErrors(visitorPage);

    try {
      const boardUrl = publicBoardUrl(user.workspaceName);
      await visitorPage.goto(boardUrl);
      await waitForHydration(visitorPage);

      // The home filters are the board's own search params: updating one must
      // keep the visitor on the board home.
      await visitorPage.getByRole("button", { name: /^Pending/ }).click();
      await expect(visitorPage).toHaveURL(/\?status=/);
      await expect(
        visitorPage.getByRole("button", { name: "Give Feedback" })
      ).toBeVisible();

      // A post's sidebar board link lands on the board page, whatever the
      // host serves the board under.
      await visitorPage.getByRole("link", { name: title }).click();
      await expect(
        visitorPage.getByRole("link", { name: "Features 💡" })
      ).toBeVisible();
      await visitorPage.getByRole("link", { name: "Features 💡" }).click();
      await expect(visitorPage).toHaveURL(`${boardUrl}/b/features`);
      await expect(
        visitorPage.getByRole("heading", { name: "Features 💡" })
      ).toBeVisible();

      await assertNoPageErrors(visitorPage);
    } finally {
      await visitorContext.close();
    }
  }
);

test(
  "a guest's comments stay visible after the page settles",
  { tag: "@critical" },
  async ({ browser, page }) => {
    // The post route's `beforeLoad` preloads the comment subset through an
    // on-demand collection. That preload's demand is released a few seconds
    // after the page loads; if the preload keyed its subset differently from
    // the list component (e.g. before the board scope carried the organization
    // id), the release deletes the rows the guest is reading and the comments
    // vanish without a refetch. This holds the window open past the release.
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const title = `Guest comments ${randomUUID().slice(0, 8)}`;
    const comment = `Public comment ${randomUUID().slice(0, 8)}`;
    await createPost(page, title, "Comments must survive for guests.");
    await openPost(page, title);
    await addPublicComment(page, comment);

    const slug = new URL(page.url()).pathname
      .split("/")
      .findLast((segment) => segment.length > 0);

    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    trackPageErrors(visitorPage);

    try {
      await visitorPage.goto(`${publicBoardUrl(user.workspaceName)}/p/${slug}`);

      const commentCard = visitorPage
        .locator('[data-slot="comment"]')
        .filter({ hasText: comment });
      await expect(commentCard).toBeVisible();

      // The preload's subset is unloaded well after the first paint; the
      // comment must still be there when it is.
      await visitorPage.waitForTimeout(5000);
      await expect(commentCard).toBeVisible();

      await assertNoPageErrors(visitorPage);
    } finally {
      await visitorContext.close();
    }
  }
);

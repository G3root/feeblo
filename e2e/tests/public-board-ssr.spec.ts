import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import { waitForHydration } from "../helpers/hydration";
import { assertNoPageErrors, trackPageErrors } from "../helpers/page-errors";
import { createPost } from "../helpers/posts";
import { createTestUser } from "../helpers/test-users";
import { publicBoardUrl } from "../helpers/urls";

/**
 * The public board is server-rendered: crawlers and no-JS visitors must see the
 * board's content in the raw response, and the browser must hydrate that same
 * markup without React regenerating the tree.
 *
 * These assertions read the *raw response* rather than the DOM — a client-side
 * render would produce the same DOM a moment later, so only the response body
 * can tell the two apart.
 */
test.describe("public board server rendering", () => {
  test("the raw response carries the board's content, not a shell", async ({
    page,
    request,
  }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const title = `Server rendered post ${randomUUID().slice(0, 8)}`;
    const content = "This body must be in the raw response.";
    await createPost(page, title, content);

    const boardUrl = publicBoardUrl(user.workspaceName);
    const response = await request.get(`${boardUrl}/`);

    expect(response.status()).toBe(200);
    const html = await response.text();

    // The board's own content, not a placeholder: the workspace name renders
    // in the shell, and the newest post's title in the list.
    expect(html).toContain(user.workspaceName);
    expect(html).toContain(title);
    expect(html).toContain("Powered by Feeblo");

    // No pending/loading shim and no per-user markup in a shared document.
    expect(html).not.toContain("data-board-ssr-fallback");
    expect(html).not.toContain("User menu");

    // Crawler metadata still resolves server-side.
    expect(html).toContain(`<link rel="canonical" href="${boardUrl}/"`);
    expect(html).toContain('"@type":"WebSite"');
  });

  test("a shared document is cacheable; a locale-cookie one is private", async ({
    page,
    request,
  }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const boardUrl = publicBoardUrl(user.workspaceName);

    const anonymous = await request.get(`${boardUrl}/`);
    expect(anonymous.headers()["cache-control"]).toBe(
      "public, s-maxage=60, stale-while-revalidate=300"
    );

    const localized = await request.get(`${boardUrl}/`, {
      headers: { cookie: "PARAGLIDE_LOCALE=de" },
    });
    expect(localized.headers()["cache-control"]).toBe(
      "private, max-age=0, must-revalidate"
    );
    // The document is rendered in the cookie's locale, which is why it cannot
    // be shared.
    expect(await localized.text()).toContain('<html lang="de"');
  });

  test("the browser hydrates the server's markup without regenerating it", async ({
    browser,
    page,
  }) => {
    const user = createTestUser();
    await createAuthenticatedWorkspace(page, user);

    const title = `Hydration post ${randomUUID().slice(0, 8)}`;
    await createPost(page, title, "Hydration body.");

    // A visitor without a session: the document the server sent is the
    // anonymous one, and that is what the first client render must reproduce.
    const visitorContext = await browser.newContext();
    const visitorPage = await visitorContext.newPage();
    trackPageErrors(visitorPage);

    try {
      await visitorPage.goto(`${publicBoardUrl(user.workspaceName)}/`);
      await waitForHydration(visitorPage);

      // The rendered list survives hydration, and the first interaction after
      // it lands (the click-before-hydration window is what this guards).
      await expect(
        visitorPage.getByRole("link", { name: title })
      ).toBeVisible();
      await visitorPage
        .getByRole("button", { name: "Sign in / Sign up" })
        .first()
        .click();
      await expect(
        visitorPage.getByRole("dialog", { name: "Sign in / Sign up" })
      ).toBeVisible();

      await assertNoPageErrors(visitorPage);
    } finally {
      await visitorContext.close();
    }
  });
});

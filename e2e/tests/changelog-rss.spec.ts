import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

function publicBoardUrl(workspaceName: string) {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const baseURL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101");
  return `${baseURL.protocol}//${subdomain}.${baseURL.hostname}${baseURL.port ? `:${baseURL.port}` : ""}`;
}

async function openNewChangelogEntry(page: Page, title: string) {
  await page.getByRole("link", { name: "Changelog", exact: true }).click();
  await page.getByRole("button", { name: "New Entry" }).click();

  await page.getByLabel("Post Title").fill(title);

  const editor = page.locator(".ProseMirror");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText("Published from an RSS e2e test.");
}

async function publishEntry(page: Page, slug: string) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();

  const dialog = page.getByRole("alertdialog", { name: "Save changelog" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Slug").fill(slug);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Changelog published")).toBeVisible();
}

test.describe("changelog RSS feed", () => {
  test("publishes only published entries and hides hidden changelogs", async ({
    page,
  }) => {
    const user = createTestUser();
    const workspace = await createAuthenticatedWorkspace(page, user);
    await expect(page).toHaveURL(workspace.organizationUrl);

    const title = `RSS changelog ${randomUUID().slice(0, 8)}`;
    const slug = `rss-${randomUUID().slice(0, 8)}`;
    const boardUrl = publicBoardUrl(user.workspaceName);

    // Draft entries must not leak into the feed.
    await openNewChangelogEntry(page, title);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByText("Changes saved")).toBeVisible();

    const draftFeed = await page.request.get(`${boardUrl}/changelog/rss.xml`);
    expect(draftFeed.status()).toBe(200);
    expect(await draftFeed.text()).not.toContain(title);

    // Publish the draft and verify it appears in the feed.
    await page.getByRole("link", { name: "Changelog", exact: true }).click();
    await page.getByRole("link", { name: title }).click();
    await publishEntry(page, slug);

    const response = await page.request.get(`${boardUrl}/changelog/rss.xml`);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/rss+xml");
    const body = await response.text();
    expect(body).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(body).toContain('<rss version="2.0"');
    expect(body).toContain(`<title>${user.workspaceName}</title>`);
    expect(body).toContain(`<link>${boardUrl}/changelog</link>`);
    expect(body).toContain(`<title>${title}</title>`);
    expect(body).toContain(`<link>${boardUrl}/changelog/${slug}</link>`);
    expect(body).toContain(
      "<![CDATA[<p>Published from an RSS e2e test.</p>]]>"
    );
    expect(body).toContain('<guid isPermaLink="false">');
    expect(body).toContain(`<source url="${boardUrl}/changelog/rss.xml">`);
    expect(body).toContain("<generator>Feeblo</generator>");
    expect(body).toContain("<ttl>60</ttl>");

    // A hidden changelog must not be served through RSS.
    await page.goto(`${workspace.organizationUrl}/settings/changelog-privacy`);
    await page.getByRole("switch").click();
    await expect(page.getByText("Changelog privacy updated")).toBeVisible();

    const hiddenResponse = await page.request.get(
      `${boardUrl}/changelog/rss.xml`
    );
    expect(hiddenResponse.status()).toBe(404);

    // An unknown subdomain never serves a feed.
    const baseURL = new URL(
      process.env.E2E_BASE_URL ?? "http://localhost:3101"
    );
    const unknownResponse = await page.request.get(
      `${baseURL.protocol}//does-not-exist.${baseURL.hostname}${baseURL.port ? `:${baseURL.port}` : ""}/changelog/rss.xml`
    );
    expect(unknownResponse.status()).toBe(404);
  });
});

import { randomUUID } from "node:crypto";

import { expect, type Page, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import { createTestUser } from "../helpers/test-users";

function publicBoardUrl(workspaceName: string) {
  const subdomain = workspaceName.toLowerCase().replaceAll(" ", "-");
  const baseURL = new URL(process.env.E2E_BASE_URL ?? "http://localhost:3101");
  return `${baseURL.protocol}//${subdomain}.${baseURL.hostname}${baseURL.port ? `:${baseURL.port}` : ""}`;
}

async function fillEditor(page: Page, content: string) {
  const editor = page.locator(".ProseMirror").first();
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText(content);
}

async function createPost(page: Page, title: string) {
  await page.getByRole("button", { name: "New post" }).click();

  const dialog = page.getByRole("dialog", { name: "Create Post" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Post Title").fill(title);
  await fillEditor(page, "Published from an SEO e2e test.");

  await dialog.getByRole("combobox").first().click();
  await page.getByRole("option", { name: "Features 💡" }).click();

  await dialog.getByRole("button", { name: "Create Post" }).click();
  await expect(dialog).toBeHidden();

  await expect(
    page.getByRole("link", { name: new RegExp(title) })
  ).toBeVisible();
}

async function publishChangelogEntry(page: Page, title: string, slug: string) {
  await page.getByRole("link", { name: "Changelog", exact: true }).click();
  await page.getByRole("button", { name: "New Entry" }).click();

  await page.getByLabel("Post Title").fill(title);
  await fillEditor(page, "Changelog entry from an SEO e2e test.");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();

  await page.getByRole("link", { name: "Changelog", exact: true }).click();
  await page.getByRole("link", { name: title }).click();
  await page.getByRole("button", { name: "Publish", exact: true }).click();

  const dialog = page.getByRole("alertdialog", { name: "Save changelog" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("Slug").fill(slug);
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText("Changelog published")).toBeVisible();
}

/**
 * The structured-data scripts rendered into the initial HTML by the server.
 * The board is a client-rendered SPA, so everything a crawler sees must be
 * present before hydration.
 */
function jsonLdScripts(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(
      document.querySelectorAll('script[type="application/ld+json"]')
    ).map((script) => script.textContent ?? "")
  );
}

test.describe("public board SEO", () => {
  test("exposes robots.txt, sitemap.xml, and JSON-LD for an indexable site", async ({
    page,
  }) => {
    const user = createTestUser();
    const workspace = await createAuthenticatedWorkspace(page, user);
    await expect(page).toHaveURL(workspace.organizationUrl);

    const title = `SEO post ${randomUUID().slice(0, 8)}`;
    await createPost(page, title);

    const changelogTitle = `SEO changelog ${randomUUID().slice(0, 8)}`;
    const changelogSlug = `seo-${randomUUID().slice(0, 8)}`;
    await publishChangelogEntry(page, changelogTitle, changelogSlug);

    const boardUrl = publicBoardUrl(user.workspaceName);

    // robots.txt advertises the sitemap and keeps crawlers off non-content
    // paths (the internal /s/ rewrite prefix and dashboard auth pages).
    const robots = await page.request.get(`${boardUrl}/robots.txt`);
    expect(robots.status()).toBe(200);
    expect(robots.headers()["content-type"]).toContain("text/plain");
    const robotsBody = await robots.text();
    expect(robotsBody).toContain("User-agent: *");
    expect(robotsBody).toContain("Allow: /");
    expect(robotsBody).toContain("Disallow: /s/");
    expect(robotsBody).toContain(`Sitemap: ${boardUrl}/sitemap.xml`);

    // The dashboard host is an authenticated app shell with no indexable
    // content, so it blocks every crawler and advertises no sitemap.
    const dashboardRobots = await page.request.get("/robots.txt");
    expect(dashboardRobots.status()).toBe(200);
    const dashboardRobotsBody = await dashboardRobots.text();
    expect(dashboardRobotsBody).toContain("Disallow: /");
    expect(dashboardRobotsBody).not.toContain("Sitemap:");

    // The sitemap lists the home page, the published changelog entry, and
    // the post with a lastmod date.
    const sitemap = await page.request.get(`${boardUrl}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    expect(sitemap.headers()["content-type"]).toContain("application/xml");
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemapBody).toContain(`<loc>${boardUrl}/</loc>`);
    expect(sitemapBody).toContain(`<loc>${boardUrl}/changelog</loc>`);
    expect(sitemapBody).toContain(
      `<loc>${boardUrl}/changelog/${changelogSlug}</loc>`
    );
    // The workspace has exactly one post, so its detail URL is the only
    // /p/ entry in the sitemap.
    const postUrl =
      /<loc>([^<]+\/p\/[^<]+)<\/loc>\s*<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/.exec(
        sitemapBody
      )?.[1];
    expect(postUrl).toBeTruthy();

    // The post detail page carries per-page metadata and structured data.
    await page.goto(postUrl!);
    await expect(page).toHaveTitle(`${title} — ${user.workspaceName}`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      postUrl!
    );
    const postScripts = await jsonLdScripts(page);
    // Every node must remain parseable JSON: the HTML-delimiter escaping
    // keeps the embedded serialization intact inside the script element.
    for (const script of postScripts) {
      expect(() => JSON.parse(script)).not.toThrow();
    }
    expect(postScripts).toContainEqual(
      expect.stringContaining(
        `"@type":"WebSite","name":"${user.workspaceName}"`
      )
    );
    const postNode = postScripts.find((script) =>
      script.includes('"@type":"SocialMediaPosting"')
    );
    expect(postNode).toBeDefined();
    expect(postNode).toContain(`"headline":"${title}"`);
    expect(postNode).toContain(`"url":"${postUrl}"`);
    expect(postNode).toContain('"datePublished":"');
    expect(postNode).toMatch(/"author":\{"@type":"Person","name":"[^"]+"\}/);

    // The changelog detail page is an Article with the same treatment.
    const changelogUrl = `${boardUrl}/changelog/${changelogSlug}`;
    await page.goto(changelogUrl);
    await expect(page).toHaveTitle(
      `${changelogTitle} — ${user.workspaceName} changelog`
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      changelogUrl
    );
    const changelogScripts = await jsonLdScripts(page);
    const articleNode = changelogScripts.find((script) =>
      script.includes('"@type":"Article"')
    );
    expect(articleNode).toBeDefined();
    expect(articleNode).toContain(`"headline":"${changelogTitle}"`);
    expect(articleNode).toContain(`"url":"${changelogUrl}"`);

    // The home page canonical is the site root, not the rewrite target.
    await page.goto(`${boardUrl}/`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `${boardUrl}/`
    );
  });

  test("hides a noIndex site from robots.txt and the sitemap", async ({
    page,
  }) => {
    const user = createTestUser();
    const workspace = await createAuthenticatedWorkspace(page, user);
    await expect(page).toHaveURL(workspace.organizationUrl);

    await page.goto(`${workspace.organizationUrl}/settings/customize`);
    const indexingCard = page
      .locator('[data-slot="switch-card"]')
      .filter({ hasText: "Hide from search engines" });
    await indexingCard.getByRole("switch").click();
    await expect(
      page.getByText("Search engine visibility updated")
    ).toBeVisible();

    const boardUrl = publicBoardUrl(user.workspaceName);

    // robots.txt blocks every crawler and no longer advertises a sitemap.
    const robots = await page.request.get(`${boardUrl}/robots.txt`);
    expect(robots.status()).toBe(200);
    const robotsBody = await robots.text();
    expect(robotsBody).toContain("Disallow: /");
    expect(robotsBody).not.toContain("Sitemap:");

    // The sitemap is served but advertises no URLs.
    const sitemap = await page.request.get(`${boardUrl}/sitemap.xml`);
    expect(sitemap.status()).toBe(200);
    const sitemapBody = await sitemap.text();
    expect(sitemapBody).toContain("<urlset");
    expect(sitemapBody).not.toContain("<loc>");

    // A host without a site keeps crawlers out entirely.
    const baseURL = new URL(
      process.env.E2E_BASE_URL ?? "http://localhost:3101"
    );
    const unknownRobots = await page.request.get(
      `${baseURL.protocol}//does-not-exist.${baseURL.hostname}${baseURL.port ? `:${baseURL.port}` : ""}/robots.txt`
    );
    expect(unknownRobots.status()).toBe(200);
    expect(await unknownRobots.text()).toContain("Disallow: /");
  });
});

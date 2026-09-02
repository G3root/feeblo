import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createWorkspace } from "../helpers/auth";
import {
  createChangelogDraft,
  openChangelogEntry,
  publishOpenChangelogEntry,
} from "../helpers/changelog";
import { createPost } from "../helpers/posts";
import { createTestUser } from "../helpers/test-users";
import { publicBoardUrl } from "../helpers/urls";

/**
 * The structured-data scripts rendered into the initial HTML by the server.
 * The board is a client-rendered SPA, so everything a crawler sees must be
 * present before hydration; crawlers read the raw response body, so the
 * scripts are extracted from that body rather than from the hydrated DOM.
 */
function jsonLdScripts(html: string): string[] {
  return Array.from(
    html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g),
    (match) => match[1] ?? ""
  );
}

test.describe("public board SEO", () => {
  test("exposes robots.txt, sitemap.xml, and JSON-LD for an indexable site", async ({
    page,
  }) => {
    const user = createTestUser();
    await createWorkspace(page, user);

    const title = `SEO post ${randomUUID().slice(0, 8)}`;
    await createPost(page, title, "Published from an SEO e2e test.");

    const changelogTitle = `SEO changelog ${randomUUID().slice(0, 8)}`;
    const changelogSlug = `seo-${randomUUID().slice(0, 8)}`;
    await createChangelogDraft(
      page,
      changelogTitle,
      "Changelog entry from an SEO e2e test."
    );
    await openChangelogEntry(page, changelogTitle);
    await publishOpenChangelogEntry(page, changelogSlug);

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

    // The post detail page carries per-page metadata and structured data in
    // the raw server response — exactly what a crawler receives.
    const postResponse = await page.request.get(postUrl!);
    expect(postResponse.status()).toBe(200);
    const postScripts = jsonLdScripts(await postResponse.text());
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

    // Client-visible behavior: the browser document carries the same title
    // and canonical URL.
    await page.goto(postUrl!);
    await expect(page).toHaveTitle(`${title} — ${user.workspaceName}`);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      postUrl!
    );

    // The changelog detail page is an Article with the same treatment: the
    // structured data is asserted against the raw response body.
    const changelogUrl = `${boardUrl}/changelog/${changelogSlug}`;
    const changelogResponse = await page.request.get(changelogUrl);
    expect(changelogResponse.status()).toBe(200);
    const changelogScripts = jsonLdScripts(await changelogResponse.text());
    const articleNode = changelogScripts.find((script) =>
      script.includes('"@type":"Article"')
    );
    expect(articleNode).toBeDefined();
    expect(articleNode).toContain(`"headline":"${changelogTitle}"`);
    expect(articleNode).toContain(`"url":"${changelogUrl}"`);

    await page.goto(changelogUrl);
    await expect(page).toHaveTitle(
      `${changelogTitle} — ${user.workspaceName} changelog`
    );
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      changelogUrl
    );

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
    const workspace = await createWorkspace(page, user);

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

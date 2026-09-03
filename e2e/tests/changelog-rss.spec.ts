import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { createAuthenticatedWorkspace } from "../helpers/auth";
import {
  createChangelogDraft,
  openChangelogEntry,
  publishOpenChangelogEntry,
} from "../helpers/changelog";
import { createTestUser } from "../helpers/test-users";
import { publicBoardUrl, unknownPublicBoardUrl } from "../helpers/urls";

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
    await createChangelogDraft(page, title, "Published from an RSS e2e test.");

    const draftFeed = await page.request.get(`${boardUrl}/changelog/rss.xml`);
    expect(draftFeed.status()).toBe(200);
    expect(await draftFeed.text()).not.toContain(title);

    // Publish the draft and verify it appears in the feed.
    await openChangelogEntry(page, title);
    await publishOpenChangelogEntry(page, slug);

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
    const unknownResponse = await page.request.get(
      `${unknownPublicBoardUrl()}/changelog/rss.xml`
    );
    expect(unknownResponse.status()).toBe(404);
  });
});

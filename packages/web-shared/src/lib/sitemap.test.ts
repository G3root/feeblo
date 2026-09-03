import { describe, expect, it } from "vitest";

import {
  buildSitemap,
  buildSitemapIndex,
  escapeXml,
  MAX_URLS_PER_SITEMAP,
  renderSitemap,
  toIsoDateOnly,
  type SitemapUrl,
} from "./sitemap";

const url = (loc: string, lastmod?: string): SitemapUrl => ({ loc, lastmod });

describe("escapeXml", () => {
  it("escapes XML special characters", () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      "a &amp; b &lt; c &gt; d &quot; e &apos; f"
    );
  });
});

describe("buildSitemap", () => {
  it("renders a urlset with loc and optional lastmod entries", () => {
    const xml = buildSitemap([
      url("https://acme.example.com/", "2025-01-31"),
      url("https://acme.example.com/p/dark-mode"),
    ]);

    expect(xml).toContain(
      `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`
    );
    expect(xml).toContain(
      "<loc>https://acme.example.com/</loc>\n    <lastmod>2025-01-31</lastmod>"
    );
    expect(xml).toContain("<loc>https://acme.example.com/p/dark-mode</loc>");
    // Entries without lastmod must not emit an empty element.
    expect(xml.match(/<lastmod>/g)).toHaveLength(1);
  });

  it("escapes URLs from user-generated slugs", () => {
    const xml = buildSitemap([url("https://acme.example.com/p/a&b")]);

    expect(xml).toContain("<loc>https://acme.example.com/p/a&amp;b</loc>");
  });
});

describe("buildSitemapIndex", () => {
  it("renders one sitemap entry per page", () => {
    const xml = buildSitemapIndex("https://acme.example.com", 2);

    expect(xml).toContain("<sitemapindex");
    expect(xml).toContain(
      "<loc>https://acme.example.com/sitemap.xml?page=1</loc>"
    );
    expect(xml).toContain(
      "<loc>https://acme.example.com/sitemap.xml?page=2</loc>"
    );
  });
});

describe("renderSitemap", () => {
  const manyUrls = Array.from(
    { length: MAX_URLS_PER_SITEMAP + 1 },
    (_, index) => url(`https://acme.example.com/p/post-${index}`)
  );

  it("renders a single sitemap when under the limit", () => {
    const xml = renderSitemap([url("https://acme.example.com/")], "", null);

    expect(xml).toContain("<urlset");
    expect(xml).not.toContain("<sitemapindex");
  });

  it("renders a sitemap index when over the limit and paginates by page", () => {
    const index = renderSitemap(manyUrls, "https://acme.example.com", null);
    expect(index).toContain("<sitemapindex");

    const firstPage = renderSitemap(manyUrls, "https://acme.example.com", 1);
    expect(firstPage).toContain("<loc>https://acme.example.com/p/post-0</loc>");
    expect(firstPage).not.toContain(
      "<loc>https://acme.example.com/p/post-50000</loc>"
    );

    const secondPage = renderSitemap(manyUrls, "https://acme.example.com", 2);
    expect(secondPage).toContain(
      "<loc>https://acme.example.com/p/post-50000</loc>"
    );
  });

  it("returns null for out-of-range pages", () => {
    expect(renderSitemap([url("https://acme.example.com/")], "", 0)).toBeNull();
    expect(renderSitemap([url("https://acme.example.com/")], "", 2)).toBeNull();
    expect(
      renderSitemap([url("https://acme.example.com/")], "", Number.NaN)
    ).toBeNull();
  });
});

describe("toIsoDateOnly", () => {
  it("formats a date as a W3C date-only string in UTC", () => {
    expect(toIsoDateOnly(new Date("2025-01-31T23:30:00Z"))).toBe("2025-01-31");
  });
});

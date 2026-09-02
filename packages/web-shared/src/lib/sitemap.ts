/**
 * Pure sitemap XML builders following the Sitemaps protocol
 * (https://www.sitemaps.org/protocol.html).
 *
 * - Up to {@link MAX_URLS_PER_SITEMAP} URLs per sitemap file; larger sets are
 *   split into a sitemap index with `?page=N` sitemap entries.
 * - Only `lastmod` is emitted (W3C date format); `priority`/`changefreq` are
 *   ignored by crawlers.
 */

export const MAX_URLS_PER_SITEMAP = 50_000;

export interface SitemapUrl {
  /** Absolute URL of the page. */
  readonly loc: string;
  /** Last modification date in W3C date format (e.g. `2025-01-31`). */
  readonly lastmod?: string;
}

/** Escape a string for safe inclusion in an XML text node or attribute. */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/** Render a `<urlset>` document from the given URLs. */
export function buildSitemap(urls: ReadonlyArray<SitemapUrl>): string {
  const urlEntries = urls
    .map(
      (url) =>
        `  <url>\n    <loc>${escapeXml(url.loc)}</loc>${
          url.lastmod
            ? `\n    <lastmod>${escapeXml(url.lastmod)}</lastmod>`
            : ""
        }\n  </url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urlEntries}\n</urlset>`;
}

/** Render a `<sitemapindex>` pointing at `?page=N` sitemap pages. */
export function buildSitemapIndex(baseUrl: string, totalPages: number): string {
  const entries = Array.from({ length: totalPages }, (_, index) => {
    const page = index + 1;
    return `  <sitemap>\n    <loc>${escapeXml(`${baseUrl}/sitemap.xml?page=${page}`)}</loc>\n  </sitemap>`;
  }).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>`;
}

/**
 * Render the response body for the collected URLs.
 *
 * - Under the limit without a page param: a single sitemap.
 * - Over the limit without a page param: a sitemap index.
 * - With a page param: that page's slice, or `null` when the page is not a
 *   valid integer or is out of range.
 */
export function renderSitemap(
  urls: ReadonlyArray<SitemapUrl>,
  baseUrl: string,
  page: number | null
): string | null {
  if (urls.length <= MAX_URLS_PER_SITEMAP && page === null) {
    return buildSitemap(urls);
  }

  const totalPages = Math.ceil(urls.length / MAX_URLS_PER_SITEMAP);

  if (page === null) {
    return buildSitemapIndex(baseUrl, totalPages);
  }

  if (!Number.isInteger(page) || page < 1 || page > totalPages) {
    return null;
  }

  const start = (page - 1) * MAX_URLS_PER_SITEMAP;
  return buildSitemap(urls.slice(start, start + MAX_URLS_PER_SITEMAP));
}

/** Format a date as a W3C date-only string (`YYYY-MM-DD`). */
export function toIsoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

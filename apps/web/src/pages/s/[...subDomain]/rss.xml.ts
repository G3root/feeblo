import rss, { type RSSFeedItem } from "@astrojs/rss";
import type { TChangelog } from "@feeblo/domain/changelog/schema";
import type { APIRoute } from "astro";

export const prerender = false;

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const escapeCdata = (value: string): string =>
  value.replaceAll("]]>", "]]]]><![CDATA[>");

/**
 * RSS 2.0 feed for the public changelog, served at
 * `https://<subdomain>.<root-domain>/changelog/rss.xml`.
 *
 * The middleware resolves `locals.site` from the request host; when the site
 * does not exist or its changelog is hidden, the feed is a 404 so hidden
 * changelogs are never exposed through RSS.
 *
 * Descriptions contain rendered HTML in CDATA. This keeps the feed readable
 * in clients that support HTML while avoiding Markdown being shown literally.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const site = locals.site;

  if (site === null || site.changelogVisibility !== "PUBLIC") {
    return new Response("Not found", { status: 404 });
  }

  const origin = url.origin;
  const changelogUrl = `${origin}/changelog`;
  const feedUrl = `${changelogUrl}/rss.xml`;

  // `@astrojs/rss` escapes text nodes and cannot emit CDATA sections. Use
  // request-scoped markers and replace them after the feed is generated.
  // A non-security marker: use Web Crypto for collision-resistant randomness.
  const cdataBytes = new Uint8Array(8);
  crypto.getRandomValues(cdataBytes);
  const cdataNonce = Array.from(cdataBytes, (byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
  const cdataSections: Array<{ marker: string; content: string }> = [];

  let changelogs: readonly TChangelog[];

  try {
    // Lazy-load the Effect RPC runtime so it stays out of the worker's
    // startup module graph; it is only needed for this feed's data fetch.
    const { fetchRpcServer } = await import("~/lib/runtime-server");
    changelogs = await fetchRpcServer((rpc) =>
      rpc.ChangelogListPublic({ organizationId: site.organizationId })
    );
  } catch {
    return new Response("Feed unavailable", { status: 502 });
  }

  // Lazy-load the markdown pipeline (unified/remark/rehype) with the request
  // so it stays out of the worker's startup module graph (same pattern as the
  // RPC runtime import above). Rendering itself is cached per entry version
  // in `@feeblo/utils/markdown`.
  const { markdownToHtmlCached } = await import("@feeblo/utils/markdown");

  const items: RSSFeedItem[] = changelogs.map((changelog, index) => {
    const content = markdownToHtmlCached(
      `${changelog.id}:${String(changelog.updatedAt)}`,
      changelog.content
    ).trim();
    const item: RSSFeedItem = {
      title: changelog.title,
      link: `${changelogUrl}/${changelog.slug}`,
      pubDate: changelog.publishedAt ?? changelog.createdAt,
      // Keep IDs stable if a changelog slug is later edited.
      customData: `<guid isPermaLink="false">${escapeXml(changelog.id)}</guid>`,
      source: {
        url: feedUrl,
        title: `${site.name} Changelog`,
      },
    };

    if (changelog.user.name) {
      item.author = changelog.user.name;
    }

    if (content !== "") {
      const marker = `__feeblo_cdata_${cdataNonce}_${index}__`;
      cdataSections.push({ marker, content });
      item.description = marker;
    }

    return item;
  });

  const image = site.logo
    ? `<image><title>${escapeXml(site.name)}</title><link>${escapeXml(changelogUrl)}</link><url>${escapeXml(site.logo)}</url><description>Read the ${escapeXml(site.name)} Changelog</description></image>`
    : "";

  const response = await rss({
    title: site.name,
    description: `Changelog for ${site.name}`,
    site: changelogUrl,
    trailingSlash: false,
    items,
    customData: [
      `<atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />`,
      "<generator>Feeblo</generator>",
      image,
      "<ttl>60</ttl>",
    ].join(""),
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
  });

  // `rss()` returns `application/xml`; use the canonical RSS content type.
  // Do not cache until mutation-triggered cache purging is available, so
  // visibility changes and newly published entries are reflected immediately.
  let body = await response.text();
  for (const { marker, content } of cdataSections) {
    body = body.replace(marker, `<![CDATA[${escapeCdata(content)}]]>`);
  }

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      //TODO: Re-evaluate caching
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
};

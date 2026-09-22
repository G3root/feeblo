import type { TChangelog } from "@feeblo/domain/changelog/schema";
import type { TSite } from "@feeblo/domain/site/schema";
import { extractSubdomain } from "@feeblo/utils/url";
import {
  renderSitemap,
  toIsoDateOnly,
  type SitemapUrl,
} from "@feeblo/web-shared/sitemap";

import { fetchRpcServer } from "~/lib/runtime-server";
import { resolveSite } from "~/lib/site";

/**
 * The public board's crawler endpoints (robots.txt, sitemap.xml, changelog
 * RSS), ported from the Astro endpoints.
 *
 * They stay raw HTTP responses rather than router data: crawlers and feed
 * readers are the contract. Each resolves the site from the request host with
 * a fresh lookup per request (the site row carries privacy flags that must
 * surface immediately), and the shared helpers here keep the dashboard's
 * robots.txt and the board's in one place.
 */

const XML_CACHE_CONTROL = "public, max-age=300, s-maxage=300";

function resolveSubdomain(request: Request) {
  return extractSubdomain({
    url: request.url,
    rootDomain: process.env.APP_ROOT_DOMAIN ?? "",
  });
}

export async function resolveBoardSite(request: Request): Promise<TSite | null> {
  const subdomain = resolveSubdomain(request);
  return subdomain ? resolveSite(subdomain) : null;
}

const robotsResponse = (lines: ReadonlyArray<string>) =>
  new Response(`${lines.join("\n")}\n`, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      //TODO: Re-evaluate caching (same constraint as the RSS feed: no
      // mutation-triggered cache purge yet, so noIndex changes must surface
      // within the cache lifetime).
      "Cache-Control": XML_CACHE_CONTROL,
      // robots.txt is per-host content on a shared path; public board hosts
      // and the dashboard host serve different bodies.
      Vary: "Host",
    },
  });

/**
 * robots.txt for the dashboard host (`app.<root-domain>` and the apex
 * domain), where every page sits behind authentication or is a client-side
 * app shell with no indexable content.
 */
export function handleDashboardRobots() {
  return robotsResponse(["User-agent: *", "Disallow: /"]);
}

/**
 * robots.txt for public board hosts. Sites flagged `noIndex` (or a deployment
 * with the `NO_INDEX` env secret) get a blanket `Disallow` with no sitemap
 * link: neither crawlable nor advertised.
 *
 * For indexable sites the disallowed paths are the ones that exist on public
 * board hosts but carry no indexable content: the dashboard auth pages (the
 * middleware keeps serving them from the dashboard app on any host), the
 * feedback widget document, and the internal `/s/...` rewrite prefix whose
 * pages duplicate the canonical public URLs.
 */
export async function handleBoardRobots(request: Request) {
  let site: TSite | null;
  try {
    site = await resolveBoardSite(request);
  } catch {
    // Fail closed: an outage must not expose an indexable response.
    return robotsResponse(["User-agent: *", "Disallow: /"]);
  }

  if (site === null || site.noIndex || Boolean(process.env.NO_INDEX)) {
    return robotsResponse(["User-agent: *", "Disallow: /"]);
  }

  const origin = new URL(request.url).origin;

  return robotsResponse([
    "User-agent: *",
    "Allow: /",
    "Disallow: /s/",
    "Disallow: /feedback-widget",
    "Disallow: /sign-in",
    "Disallow: /sign-up",
    "Disallow: /email-verify",
    "Disallow: /forgot-password",
    "Disallow: /reset-password",
    "",
    `Sitemap: ${origin}/sitemap.xml`,
  ]);
}

const xmlResponse = (body: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      //TODO: Re-evaluate caching (same constraint as the RSS feed).
      "Cache-Control": XML_CACHE_CONTROL,
    },
  });

/**
 * Sitemap protocol feed for the public board. The site resolves from the
 * request host with a fresh lookup per request; a host without a site is a
 * 404. Sites flagged `noIndex` get an empty urlset: robots.txt already tells
 * crawlers to keep out, so no URLs are advertised.
 *
 * The sitemap only contains URLs the anonymous public can already see: posts
 * from public boards (`PostListPublic`), published changelog entries
 * (`ChangelogListPublic`, gated on the site's changelog visibility), and
 * public roadmaps (`RoadmapListPublic`, gated on the site's roadmap
 * visibility). Board pages are included without `lastmod` because a board
 * row only changes when its name changes, not when its posts do.
 *
 * Over {@link renderSitemap}'s per-file URL limit the endpoint serves a
 * sitemap index and honors `?page=N` slices, keeping each file inside the
 * protocol's 50,000-URL cap.
 */
export async function handleBoardSitemap(request: Request) {
  const url = new URL(request.url);
  let site: TSite | null;
  try {
    site = await resolveBoardSite(request);
  } catch {
    return new Response("Sitemap unavailable", { status: 502 });
  }

  if (site === null) {
    return new Response("Not found", { status: 404 });
  }

  const origin = url.origin;

  // The env flag covers preview/staging deployments; the site flag covers
  // per-site opt-outs. Either one removes the whole site from search.
  if (site.noIndex || Boolean(process.env.NO_INDEX)) {
    return xmlResponse(renderSitemap([], origin, null) ?? "");
  }

  let urls: ReadonlyArray<SitemapUrl>;

  try {
    urls = await collectUrls(site, origin);
  } catch {
    return new Response("Sitemap unavailable", { status: 502 });
  }

  const pageParam = url.searchParams.get("page");
  // Only a complete decimal integer selects a page slice: `Number.parseInt`
  // accepts trailing junk ("1junk") and decimals ("1.5") as page 1, which
  // would duplicate the base sitemap instead of the documented 404. A
  // missing param stays `null` (single sitemap or index); any malformed
  // value fails `renderSitemap`'s integer check and 404s.
  const page =
    pageParam === null
      ? null
      : /^\d+$/.test(pageParam)
        ? Number.parseInt(pageParam, 10)
        : Number.NaN;
  const xml = renderSitemap(urls, origin, page);

  if (xml === null) {
    return new Response("Not found", { status: 404 });
  }

  return xmlResponse(xml);
}

async function collectUrls(
  site: TSite,
  origin: string
): Promise<ReadonlyArray<SitemapUrl>> {
  const urls: SitemapUrl[] = [{ loc: `${origin}/` }];

  // The four list fetches are independent, so fire them together and pay
  // one RPC round-trip instead of four sequential ones. Visibility-gated
  // lists resolve to empty without a request.
  const [roadmaps, entries, boards, posts] = await Promise.all([
    site.roadmapVisibility === "PUBLIC"
      ? fetchRpcServer((rpc) =>
          rpc.RoadmapListPublic({ organizationId: site.organizationId })
        )
      : Promise.resolve([]),
    site.changelogVisibility === "PUBLIC"
      ? fetchRpcServer((rpc) =>
          rpc.ChangelogListPublic({ organizationId: site.organizationId })
        )
      : Promise.resolve([]),
    fetchRpcServer((rpc) =>
      rpc.BoardListPublic({ organizationId: site.organizationId })
    ),
    fetchRpcServer((rpc) =>
      rpc.PostListPublic({
        organizationId: site.organizationId,
        boardId: null,
      })
    ),
  ]);

  if (site.roadmapVisibility === "PUBLIC") {
    urls.push({ loc: `${origin}/roadmap` });
    for (const roadmap of roadmaps) {
      urls.push({
        loc: `${origin}/roadmap/${roadmap.slug}`,
        lastmod: toIsoDateOnly(roadmap.updatedAt),
      });
    }
  }

  if (site.changelogVisibility === "PUBLIC") {
    urls.push({ loc: `${origin}/changelog` });
    for (const entry of entries) {
      urls.push({
        loc: `${origin}/changelog/${entry.slug}`,
        lastmod: toIsoDateOnly(entry.updatedAt),
      });
    }
  }

  for (const board of boards) {
    urls.push({ loc: `${origin}/b/${board.slug}` });
  }

  // Deterministic order keeps `?page=N` slices stable across requests, so
  // crawlers never see URLs migrate between sitemap pages. Code-unit
  // comparison: slugs are ASCII, so `localeCompare`'s ICU collation only
  // buys cost here (it dominates this endpoint's CPU on large boards).
  const sortedPosts = posts.toSorted((left, right) =>
    left.slug < right.slug ? -1 : left.slug > right.slug ? 1 : 0
  );
  for (const post of sortedPosts) {
    urls.push({
      loc: `${origin}/p/${post.slug}`,
      lastmod: toIsoDateOnly(post.updatedAt),
    });
  }

  return urls;
}

// Single pass: the chained `replaceAll` version re-scanned the whole
// string (including its own `&amp;` insertions) five times per value.
const escapeXml = (value: string): string =>
  value.replace(/["&'<>]/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&apos;";
    }
  });

const escapeCdata = (value: string): string =>
  value.replaceAll("]]>", "]]]]><![CDATA[>");

/**
 * RSS 2.0 feed for the public changelog, served at
 * `https://<subdomain>.<root-domain>/changelog/rss.xml`.
 *
 * The site resolves from the request host with a fresh lookup per request;
 * when the site does not exist or its changelog is hidden, the feed is a
 * 404 so hidden changelogs are never exposed through RSS.
 *
 * The Astro endpoint delegated the envelope to `@astrojs/rss` and then
 * post-processed CDATA markers into it. The envelope is hand-written here
 * instead — it is a fixed, small document, and dropping the Astro-only
 * package keeps the endpoint portable to any server framework.
 *
 * Descriptions contain rendered HTML in CDATA. This keeps the feed readable
 * in clients that support HTML while avoiding Markdown being shown literally.
 */
export async function handleBoardRss(request: Request) {
  let site: TSite | null;
  try {
    site = await resolveBoardSite(request);
  } catch {
    return new Response("Feed unavailable", { status: 502 });
  }

  if (site === null || site.changelogVisibility !== "PUBLIC") {
    return new Response("Not found", { status: 404 });
  }

  const origin = new URL(request.url).origin;
  const changelogUrl = `${origin}/changelog`;
  const feedUrl = `${changelogUrl}/rss.xml`;

  let changelogs: readonly TChangelog[];
  try {
    changelogs = await fetchRpcServer((rpc) =>
      rpc.ChangelogListPublic({ organizationId: site.organizationId })
    );
  } catch {
    return new Response("Feed unavailable", { status: 502 });
  }

  // Lazy-load the markdown pipeline (unified/remark/rehype) with the request
  // so it stays out of the worker's startup module graph. Rendering itself is
  // cached per entry version in `@feeblo/utils/markdown`.
  const { markdownToHtmlCached } = await import("@feeblo/utils/markdown");

  const items = changelogs.map((changelog) => {
    const content = markdownToHtmlCached(
      `${changelog.id}:${String(changelog.updatedAt)}`,
      changelog.content
    ).trim();

    const parts = [
      `<title>${escapeXml(changelog.title)}</title>`,
      `<link>${escapeXml(`${changelogUrl}/${changelog.slug}`)}</link>`,
      // Keep IDs stable if a changelog slug is later edited.
      `<guid isPermaLink="false">${escapeXml(changelog.id)}</guid>`,
      `<pubDate>${new Date(
        changelog.publishedAt ?? changelog.createdAt
      ).toUTCString()}</pubDate>`,
      `<source url="${escapeXml(feedUrl)}">${escapeXml(
        `${site.name} Changelog`
      )}</source>`,
    ];

    if (changelog.user.name) {
      parts.push(`<author>${escapeXml(changelog.user.name)}</author>`);
    }

    if (content !== "") {
      parts.push(`<description><![CDATA[${escapeCdata(content)}]]></description>`);
    }

    return `    <item>\n      ${parts.join("\n      ")}\n    </item>`;
  });

  const image = site.logo
    ? `<image><title>${escapeXml(site.name)}</title><link>${escapeXml(changelogUrl)}</link><url>${escapeXml(site.logo)}</url><description>Read the ${escapeXml(site.name)} Changelog</description></image>`
    : "";

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(site.name)}</title>
    <description>${escapeXml(`Changelog for ${site.name}`)}</description>
    <link>${escapeXml(changelogUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <generator>Feeblo</generator>
    ${image}
    <ttl>60</ttl>
${items.join("\n")}
  </channel>
</rss>
`;

  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      //TODO: Re-evaluate caching (no mutation-triggered cache purge yet, so
      // visibility changes and newly published entries surface within the
      // cache lifetime).
      "Cache-Control": XML_CACHE_CONTROL,
    },
  });
}

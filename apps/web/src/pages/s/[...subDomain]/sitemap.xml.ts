import type { TSite } from "@feeblo/domain/site/schema";
import {
  renderSitemap,
  toIsoDateOnly,
  type SitemapUrl,
} from "@feeblo/web-shared/sitemap";
import type { APIRoute } from "astro";
import { getSecret } from "astro:env/server";

export const prerender = false;

const xmlResponse = (body: string) =>
  new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      //TODO: Re-evaluate caching (same constraint as rss.xml.ts: no
      // mutation-triggered cache purge yet, so visibility changes and
      // newly published content surface within the cache lifetime).
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });

/**
 * Sitemap protocol feed for the public board, served at
 * `https://<subdomain>.<root-domain>/sitemap.xml`.
 *
 * The middleware resolves `locals.site` from the request host; a request for
 * a host without a site is a 404. Sites flagged `noIndex` get an empty
 * urlset: robots.txt already tells crawlers to keep out, so no URLs are
 * advertised.
 *
 * The sitemap only contains URLs the anonymous public can already see:
 * posts from public boards (`PostListPublic`), published changelog entries
 * (`ChangelogListPublic`, gated on the site's changelog visibility), and
 * public roadmaps (`RoadmapListPublic`, gated on the site's roadmap
 * visibility). Board pages are included without `lastmod` because a board
 * row only changes when its name changes, not when its posts do.
 *
 * Over {@link renderSitemap}'s per-file URL limit the endpoint serves a
 * sitemap index and honors `?page=N` slices, keeping each file inside the
 * protocol's 50,000-URL cap.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const site = locals.site;

  if (site === null) {
    return new Response("Not found", { status: 404 });
  }

  const origin = url.origin;

  // The env flag covers preview/staging deployments; the site flag covers
  // per-site opt-outs. Either one removes the whole site from search.
  if (site.noIndex || Boolean(getSecret("NO_INDEX"))) {
    return xmlResponse(renderSitemap([], origin, null) ?? "");
  }

  let urls: ReadonlyArray<SitemapUrl>;

  try {
    // Lazy-load the Effect RPC runtime so it stays out of the worker's
    // startup module graph (same pattern as rss.xml.ts).
    const { fetchRpcServer } = await import("~/lib/runtime-server");
    urls = await collectUrls(fetchRpcServer, site, origin);
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
};

async function collectUrls(
  fetchRpcServer: (typeof import("~/lib/runtime-server"))["fetchRpcServer"],
  site: TSite,
  origin: string
): Promise<ReadonlyArray<SitemapUrl>> {
  const urls: SitemapUrl[] = [{ loc: `${origin}/` }];

  if (site.roadmapVisibility === "PUBLIC") {
    urls.push({ loc: `${origin}/roadmap` });
    const roadmaps = await fetchRpcServer((rpc) =>
      rpc.RoadmapListPublic({ organizationId: site.organizationId })
    );
    for (const roadmap of roadmaps) {
      urls.push({
        loc: `${origin}/roadmap/${roadmap.slug}`,
        lastmod: toIsoDateOnly(roadmap.updatedAt),
      });
    }
  }

  if (site.changelogVisibility === "PUBLIC") {
    urls.push({ loc: `${origin}/changelog` });
    const entries = await fetchRpcServer((rpc) =>
      rpc.ChangelogListPublic({ organizationId: site.organizationId })
    );
    for (const entry of entries) {
      urls.push({
        loc: `${origin}/changelog/${entry.slug}`,
        lastmod: toIsoDateOnly(entry.updatedAt),
      });
    }
  }

  const boards = await fetchRpcServer((rpc) =>
    rpc.BoardListPublic({ organizationId: site.organizationId })
  );
  for (const board of boards) {
    urls.push({ loc: `${origin}/b/${board.slug}` });
  }

  const posts = await fetchRpcServer((rpc) =>
    rpc.PostListPublic({ organizationId: site.organizationId, boardId: null })
  );
  // Deterministic order keeps `?page=N` slices stable across requests, so
  // crawlers never see URLs migrate between sitemap pages.
  const sortedPosts = posts.toSorted((left, right) =>
    left.slug.localeCompare(right.slug)
  );
  for (const post of sortedPosts) {
    urls.push({
      loc: `${origin}/p/${post.slug}`,
      lastmod: toIsoDateOnly(post.updatedAt),
    });
  }

  return urls;
}

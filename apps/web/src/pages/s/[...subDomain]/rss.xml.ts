import rss from "@astrojs/rss";
import type { TChangelog } from "@feeblo/domain/changelog/schema";
import { markdownToHtml } from "@feeblo/utils/markdown";
import type { APIRoute } from "astro";
import { fetchRpcServer } from "~/lib/runtime-server";

export const prerender = false;

/**
 * RSS 2.0 feed for the public changelog, served at
 * `https://<subdomain>.<root-domain>/changelog/rss.xml`.
 *
 * The middleware resolves `locals.site` from the request host; when the site
 * does not exist or its changelog is hidden, the feed is a 404 so hidden
 * changelogs are never exposed through RSS.
 */
export const GET: APIRoute = async ({ locals, url }) => {
  const site = locals.site;

  if (site === null || site.changelogVisibility !== "PUBLIC") {
    return new Response("Not found", { status: 404 });
  }

  const origin = url.origin;
  const changelogUrl = `${origin}/changelog`;

  let changelogs: readonly TChangelog[];

  try {
    changelogs = await fetchRpcServer((rpc) =>
      rpc.ChangelogListPublic({ organizationId: site.organizationId })
    );
  } catch {
    return new Response("Feed unavailable", { status: 502 });
  }

  const response = await rss({
    title: `${site.name} changelog`,
    description: `Product updates from ${site.name}`,
    site: changelogUrl,
    trailingSlash: false,
    items: changelogs.map((changelog) => ({
      title: changelog.title,
      link: `/changelog/${changelog.slug}`,
      pubDate: changelog.publishedAt ?? undefined,
      description: changelog.excerpt,
      content: markdownToHtml(changelog.content),
    })),
    customData: `<language>en</language><atom:link href="${changelogUrl}/rss.xml" rel="self" type="application/rss+xml" />`,
    xmlns: { atom: "http://www.w3.org/2005/Atom" },
  });

  // `rss()` returns `application/xml`; use the canonical RSS content type and
  // add a short cache window. The feed is per-subdomain and public, so it is
  // safe to cache at the edge.
  const body = await response.text();
  return new Response(body, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
};

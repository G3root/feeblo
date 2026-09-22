import {
  changelogJsonLd,
  postJsonLd,
  websiteJsonLd,
  type JsonLdNode,
} from "@feeblo/web-shared/json-ld";
import {
  ClientOnly,
  createFileRoute,
  notFound,
  redirect,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest, setResponseHeader } from "@tanstack/react-start/server";

import { getPublicBoardPage } from "@/lib/public-board-data";
import { PublicBoardIsland } from "@/public-board/public-board-island";
import { PublicBoardSsrFallback } from "@/public-board/public-board-ssr-fallback";

/**
 * Response headers are set in the loader, not the server function: during SSR
 * the loader runs inside the page request, while a server function's own
 * response status would be interpreted by the RPC layer instead of shaping the
 * document.
 */
const applyPageHeaders = createIsomorphicFn()
  .client(() => undefined)
  .server(() => {
    setResponseHeader(
      "Cache-Control",
      "public, s-maxage=60, stale-while-revalidate=300"
    );
  });

/**
 * The public URL of the current page.
 *
 * A router location is internal (`/s/p/hello` on a board host) and its `href`
 * is relative, so the loader cannot rebuild the site's host from it. The
 * request's own URL is the public one on the server; the browser's location is
 * on the client.
 */
const currentUrl = createIsomorphicFn()
  .client(() => window.location.href)
  .server(() => getRequest().url);

/**
 * The public board, served on tenant subdomains.
 *
 * Board hosts rewrite their public paths onto this route
 * (`lib/public-board-rewrite`), so a visitor's `/p/hello` renders here as
 * `/s/p/hello` internally — the board's own router still sees `/p/hello` in
 * the browser and handles navigation. The loader resolves the site and the
 * detail content on the server, and `head()` turns that into the raw
 * response's title, description, canonical link, and JSON-LD. The SPA itself
 * is client-only (`ClientOnly`), because it owns browser history and resolves
 * its auth session client-side.
 */
export const Route = createFileRoute("/s/$")({
  loader: async () => {
    const page = await getPublicBoardPage({ data: { url: currentUrl() } });

    if (page.kind === "redirect") {
      // A merged source moves to its survivor, but unmerging is a supported
      // action: a permanent 301 would keep sending inbound links to the
      // survivor after the merge is reverted, so this is a temporary redirect
      // that proxies and browsers must not cache.
      throw redirect({
        href: page.to,
        statusCode: 302,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (page.kind === "not-found") {
      // Missing or hidden detail content: a hard 404 keeps crawlers (and
      // visitors) off URLs that would otherwise render the SPA's not-found
      // state behind a 200.
      throw notFound();
    }

    if (page.kind === "rpc-unavailable") {
      // The sibling rss/sitemap endpoints answer 502 for a downstream RPC
      // failure. Start's streaming handler does not apply a status set from a
      // loader, so this page cannot mirror that; it renders a noindex
      // "Content unavailable" document instead. A 404 (missing site or
      // content) still goes through `notFound()` and is a real 404.
      return page;
    }

    // Documents are user-independent (auth resolves client-side), so the CDN
    // may serve anonymous board HTML for a minute; crawlers and repeat
    // visitors skip SSR entirely. Visibility flips surface within the TTL,
    // matching the rss/sitemap endpoints' looser 5-minute convention.
    applyPageHeaders();

    return page;
  },
  head: ({ loaderData }) => {
    if (!loaderData || loaderData.kind !== "found") {
      return {
        meta: [
          { title: "Content unavailable" },
          { name: "robots", content: "noindex, nofollow" },
        ],
      };
    }

    const { site, post, changelog, canonicalUrl, siteUrl, ogImageUrl } =
      loaderData;
    const jsonLd: JsonLdNode[] = [
      websiteJsonLd({ name: site.name, url: siteUrl }),
    ];
    let pageTitle = `${site.name} — Feedback and roadmap`;
    let pageDescription = `Share feedback, follow the roadmap, and read product updates from ${site.name}.`;

    if (post) {
      pageTitle = `${post.title} — ${site.name}`;
      pageDescription = post.excerpt;
      jsonLd.push(
        postJsonLd({
          headline: post.title,
          description: post.excerpt,
          url: canonicalUrl,
          datePublished: post.createdAt,
          dateModified: post.updatedAt,
          authorName: post.user.name,
        })
      );
    } else if (changelog) {
      pageTitle = `${changelog.title} — ${site.name} changelog`;
      pageDescription = changelog.excerpt;
      jsonLd.push(
        changelogJsonLd({
          headline: changelog.title,
          description: changelog.excerpt,
          url: canonicalUrl,
          datePublished: changelog.publishedAt ?? changelog.createdAt,
          dateModified: changelog.updatedAt,
          authorName: changelog.user.name,
        })
      );
    }

    return {
      meta: [
        { title: pageTitle },
        { name: "description", content: pageDescription },
        ...(loaderData.noIndex
          ? [{ name: "robots", content: "noindex, nofollow" }]
          : []),
        { property: "og:title", content: pageTitle },
        { property: "og:description", content: pageDescription },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalUrl },
        { property: "og:image", content: ogImageUrl },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: `${pageTitle} social preview` },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: pageTitle },
        { name: "twitter:description", content: pageDescription },
        { name: "twitter:image", content: ogImageUrl },
        { name: "twitter:image:alt", content: `${pageTitle} social preview` },
      ],
      links: [
        { rel: "canonical", href: canonicalUrl },
        ...(site.changelogVisibility === "PUBLIC"
          ? [
              {
                rel: "alternate",
                href: "/changelog/rss.xml",
                title: `${site.name} changelog`,
                type: "application/rss+xml",
              },
            ]
          : []),
      ],
      scripts: jsonLd.map((node) => ({
        type: "application/ld+json",
        children: JSON.stringify(node)
          .replaceAll("<", "\\u003c")
          .replaceAll(">", "\\u003e")
          .replaceAll("&", "\\u0026"),
      })),
    };
  },
  component: PublicBoardRoute,
});

function PublicBoardRoute() {
  const page = Route.useLoaderData();

  if (page.kind !== "found") {
    return (
      <main className="flex min-h-[70vh] items-center justify-center">
        <p className="text-muted-foreground text-sm">Content unavailable</p>
      </main>
    );
  }

  return (
    <main>
      <PublicBoardSsrFallback />
      <ClientOnly fallback={null}>
        <PublicBoardIsland site={page.site} />
      </ClientOnly>
    </main>
  );
}

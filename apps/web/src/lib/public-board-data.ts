import type { TChangelog } from "@feeblo/domain/changelog/schema";
import type { TPost } from "@feeblo/domain/post/schema";
import type { TSite } from "@feeblo/domain/site/schema";
import { extractSubdomain } from "@feeblo/utils/url";
import { createServerFn } from "@tanstack/react-start";
import * as Effect from "effect/Effect";

import { fetchRpcServer } from "~/lib/runtime-server";
import { resolveSite } from "~/lib/site";

/**
 * The public board's server-resolved page metadata.
 *
 * The board itself is a client-rendered SPA (its own TanStack Router), but
 * crawlers never run it: this resolves the site, the page's detail content,
 * and the canonical URL on the server so the route's `head()` can render
 * per-page titles, descriptions, and JSON-LD into the raw response.
 */
export type PublicBoardPage =
  | {
      readonly kind: "found";
      readonly site: TSite;
      readonly post: TPost | null;
      readonly changelog: TChangelog | null;
      readonly canonicalUrl: string;
      readonly siteUrl: string;
      readonly ogImageUrl: string;
      readonly noIndex: boolean;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "rpc-unavailable" };

type DetailContent =
  | {
      readonly kind: "found";
      readonly post: TPost | null;
      readonly changelog: TChangelog | null;
    }
  | { readonly kind: "not-found" }
  | { readonly kind: "redirect"; readonly to: string }
  | { readonly kind: "rpc-unavailable" };

/**
 * Outcome of a detail-page lookup, keeping the three cases the page must
 * respond to apart: found content renders with per-page metadata, a missing
 * or hidden entity is a hard 404, and any other RPC failure means the
 * content backend is unavailable.
 */
async function resolvePageContent(
  publicPath: string,
  site: TSite
): Promise<DetailContent> {
  const postMatch = /^\/p\/([^/]+)$/.exec(publicPath);
  const changelogMatch = /^\/changelog\/([^/]+)$/.exec(publicPath);

  if (!postMatch && !changelogMatch) {
    return { kind: "found", post: null, changelog: null };
  }

  try {
    if (postMatch) {
      // Missing and hidden (non-public board) posts both fail the RPC with
      // the typed PostNotFoundError; translate that one tag into an explicit
      // not-found instead of swallowing it into the default metadata.
      const post = await fetchRpcServer((rpc) =>
        rpc
          .PostGetPublic({
            organizationId: site.organizationId,
            // SAFETY: The capture group matched, so the index is present.
            slug: postMatch[1],
          })
          .pipe(
            Effect.catchTag("PostNotFoundError", () => Effect.succeed(null))
          )
      );
      if (post === null) {
        // A merged source 404s publicly; resolve its survivor so inbound
        // links (and merge emails) land on the canonical post.
        const mergedTargetSlug = await fetchRpcServer((rpc) =>
          rpc.PostResolveMergedPublic({
            organizationId: site.organizationId,
            // SAFETY: The capture group matched, so the index is present.
            slug: postMatch[1],
          })
        );
        return mergedTargetSlug === null
          ? { kind: "not-found" }
          : { kind: "redirect", to: `/p/${mergedTargetSlug}` };
      }
      return { kind: "found", post, changelog: null };
    }

    if (site.changelogVisibility !== "PUBLIC") {
      // The entry is only reachable through a hidden changelog section.
      return { kind: "not-found" };
    }

    // SAFETY: `postMatch` is null here, so `changelogMatch` matched.
    const changelogSlug = changelogMatch![1];
    // Resolve the single entry directly: pulling the whole published list
    // (up to `PUBLIC_CHANGELOG_LIMIT` full bodies) per detail hit wastes
    // that entire payload for one row.
    const changelog = await fetchRpcServer((rpc) =>
      rpc
        .ChangelogGetPublic({
          organizationId: site.organizationId,
          slug: changelogSlug,
        })
        .pipe(
          Effect.catchTag("ChangelogNotFoundError", () => Effect.succeed(null))
        )
    );
    return changelog === null
      ? { kind: "not-found" }
      : { kind: "found", post: null, changelog };
  } catch {
    // Anything other than the translated not-found tag (transport errors,
    // rate limits, internal server errors) is an unexpected RPC failure.
    return { kind: "rpc-unavailable" };
  }
}

/**
 * Resolve the board page for a public URL.
 *
 * The loader is isomorphic, so the current location travels as data: the
 * server render reads its own request URL, a client navigation sends the
 * browser's. The URL is only used to look up public data, so a caller cannot
 * escalate by passing a different one.
 */
export const getPublicBoardPage = createServerFn({ method: "GET" })
  .validator((data: { url: string }) => data)
  .handler(async ({ data }): Promise<PublicBoardPage> => {
    const url = new URL(data.url);
    const subdomain = extractSubdomain({
      url: data.url,
      rootDomain: process.env.APP_ROOT_DOMAIN ?? "",
    });

    if (!subdomain) {
      return { kind: "not-found" };
    }

    let site: TSite | null;
    try {
      site = await resolveSite(subdomain);
    } catch {
      return { kind: "rpc-unavailable" };
    }

    if (!site) {
      return { kind: "not-found" };
    }

    const detail = await resolvePageContent(url.pathname, site);

    if (detail.kind !== "found") {
      return detail;
    }

    const ogImageUrl = new URL("/og-image", process.env.API_URL);
    ogImageUrl.searchParams.set("name", site.name);
    ogImageUrl.searchParams.set("site", site.subdomain);

    return {
      kind: "found",
      site,
      post: detail.post,
      changelog: detail.changelog,
      canonicalUrl: new URL(url.pathname, url.origin).toString(),
      siteUrl: new URL("/", url.origin).toString(),
      ogImageUrl: ogImageUrl.toString(),
      noIndex: Boolean(process.env.NO_INDEX) || site.noIndex,
    };
  });

import { isFeatureEnabled } from "@feeblo/domain/feature-flags";
import type { THelpCenterArticlePublic } from "@feeblo/domain/help-center-article/schema";
import type { TSite } from "@feeblo/domain/site/schema";
import * as Effect from "effect/Effect";

import { renderHelpCenterArticleMarkdown } from "@/lib/help-center-agent";
import { handleHelpCenterMcp } from "@/lib/help-center-mcp";
import { resolveBoardSite } from "@/lib/public-board-endpoints";
import { fetchRpcServer } from "~/lib/runtime-server";

/**
 * The agent surfaces of a board's help center: the per-article Markdown mirror
 * and the MCP server.
 *
 * Both resolve the site from the request host and read through the public
 * projections, so the help center's visibility is the only switch and a draft
 * is as unreachable here as it is on the page. They are separate from
 * `public-board-endpoints` because they serve a different question — "give me
 * this documentation" — while the sitemap and llms.txt describe the whole
 * board.
 */

/**
 * Browser-only caching for the mirror.
 *
 * Shared caches are deliberately excluded: hiding the help center is a
 * visibility change with no cache-purge hook, so a CDN copy could outlive the
 * toggle by its TTL. A private response keeps the second read in the same
 * browser cheap without letting an edge serve a page the workspace has since
 * withdrawn.
 */
const MARKDOWN_CACHE_CONTROL = "private, max-age=300";

const NOT_FOUND = () => new Response("Not found", { status: 404 });

const UNAVAILABLE = () => new Response("Unavailable", { status: 502 });

type ResolvedSite =
  | { readonly kind: "found"; readonly site: TSite }
  | { readonly kind: "not-found" }
  | { readonly kind: "unavailable" };

/**
 * The site this request belongs to, and whether its help center is readable.
 *
 * `noIndex` deliberately does not gate these responses. It is a crawler
 * instruction rather than a privacy switch — the HTML page is still served to
 * a reader — so the Markdown mirror answers with `X-Robots-Tag: noindex`
 * instead of pretending the page does not exist. Visibility is the switch that
 * decides whether the content exists at all.
 */
async function resolveReadableSite(request: Request): Promise<ResolvedSite> {
  // The flag is synchronous and off by default, so check it before the site
  // lookup: a disabled feature should not spend an RPC to answer `404`.
  if (!isFeatureEnabled("HELP_CENTER")) {
    return { kind: "not-found" };
  }

  let site: TSite | null;

  try {
    site = await resolveBoardSite(request);
  } catch {
    return { kind: "unavailable" };
  }

  if (site === null || site.helpCenterVisibility !== "PUBLIC") {
    return { kind: "not-found" };
  }

  return { kind: "found", site };
}

async function loadArticle(
  organizationId: string,
  slug: string
): Promise<THelpCenterArticlePublic | null> {
  return fetchRpcServer((rpc) =>
    rpc
      .GetHelpCenterArticlePublic({ organizationId, slug })
      .pipe(Effect.catchTag("NotFoundError", () => Effect.succeed(null)))
  );
}

/**
 * `GET /help/articles/raw/<slug>.md` on a board host.
 *
 * A mirror rather than a serializer: the body is the Markdown the editor
 * stored, and the only additions are the title and section the page renders
 * around it. `X-Robots-Tag` keeps a copy from competing with the page in a
 * search result, which is what the `.md` convention asks for.
 */
export async function handleHelpCenterArticleMarkdown(
  request: Request,
  slug: string
): Promise<Response> {
  const resolved = await resolveReadableSite(request);

  if (resolved.kind !== "found") {
    return resolved.kind === "not-found" ? NOT_FOUND() : UNAVAILABLE();
  }

  let article: THelpCenterArticlePublic | null;

  try {
    article = await loadArticle(resolved.site.organizationId, slug);
  } catch {
    return UNAVAILABLE();
  }

  if (article === null) {
    // A draft and a missing article answer the same way: an agent must not
    // learn that an unpublished page exists.
    return NOT_FOUND();
  }

  const origin = new URL(request.url).origin;
  const markdown = renderHelpCenterArticleMarkdown(article, origin);

  return new Response(markdown, {
    headers: {
      "Cache-Control": MARKDOWN_CACHE_CONTROL,
      "Content-Type": "text/markdown; charset=utf-8",
      Vary: "Host",
      "X-Robots-Tag": "noindex",
    },
  });
}

/**
 * `POST /mcp` on a board host.
 *
 * The endpoint is keyless because everything it can read is already public.
 * It still answers `404` when the help center is off or hidden, so a client
 * cannot use the protocol as a probe for a workspace that has not published
 * documentation.
 */
export async function handleHelpCenterMcpEndpoint(
  request: Request
): Promise<Response> {
  const resolved = await resolveReadableSite(request);

  if (resolved.kind !== "found") {
    return resolved.kind === "not-found" ? NOT_FOUND() : UNAVAILABLE();
  }

  const { site } = resolved;

  return handleHelpCenterMcp({
    dependencies: {
      getArticle: (slug) => loadArticle(site.organizationId, slug),
      listArticles: () =>
        fetchRpcServer((rpc) =>
          rpc.ListHelpCenterArticlesPublic({
            organizationId: site.organizationId,
          })
        ),
      origin: new URL(request.url).origin,
      site,
    },
    request,
  });
}

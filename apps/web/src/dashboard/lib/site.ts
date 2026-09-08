import type { TSite } from "@feeblo/domain/site/schema";

/**
 * Resolves the public-board site for a subdomain with a fresh RPC per call.
 *
 * This is intentionally uncached: the site row carries privacy flags
 * (`changelogVisibility`, `noIndex`) that the rss/sitemap/robots endpoints
 * and the public-board page gate on. An isolate-local TTL cache serves the
 * pre-toggle row until expiry, so a just-hidden changelog (or a just-set
 * noIndex flag) keeps being served — the changelog RSS e2e covers exactly
 * this read-after-toggle sequence. Transport failures propagate (and are
 * NOT cached) so callers can distinguish missing sites (null → 404) from
 * downstream outages (throw → 502).
 */
export async function resolveSite(subdomain: string): Promise<TSite | null> {
  // Lazy-load the Effect RPC runtime so it stays out of the worker's
  // startup module graph (same pattern as the feed endpoints).
  const { fetchRpcServer } = await import("./runtime-server");
  const sites = await fetchRpcServer((rpc) =>
    rpc.SiteListBySubdomain({ subdomain })
  );
  return sites[0] ?? null;
}

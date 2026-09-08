import type { TSite } from "@feeblo/domain/site/schema";
import { TTLCache } from "@isaacs/ttlcache";

// 30s TTL: hot boards skip the per-request `SiteListBySubdomain` RPC while
// subdomain renames still surface quickly. Same isolate-local TTLCache
// convention as the Markdown HTML cache (`@feeblo/utils/markdown`) and the
// og-image render cache.
const SITE_CACHE_TTL_MS = 30_000;
const SITE_CACHE_MAX_ENTRIES = 500;

const siteCache = new TTLCache<string, TSite | null>({
  max: SITE_CACHE_MAX_ENTRIES,
  ttl: SITE_CACHE_TTL_MS,
});

/**
 * Resolves the public-board site for a subdomain, cached per isolate.
 * Negative results are cached too so random-subdomain probes don't hammer
 * the API; transport failures propagate (and are NOT cached) so callers can
 * distinguish missing sites (null → 404) from downstream outages (throw →
 * 502).
 */
export async function resolveSite(subdomain: string): Promise<TSite | null> {
  const cached = siteCache.get(subdomain);
  if (cached !== undefined) {
    return cached;
  }
  // Lazy-load the Effect RPC runtime so it stays out of the worker's
  // startup module graph (same pattern as the feed endpoints).
  const { fetchRpcServer } = await import("./runtime-server");
  const sites = await fetchRpcServer((rpc) =>
    rpc.SiteListBySubdomain({ subdomain })
  );
  const site = sites[0] ?? null;
  siteCache.set(subdomain, site);
  return site;
}

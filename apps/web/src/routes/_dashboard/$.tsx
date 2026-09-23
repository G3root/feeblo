import { createFileRoute, notFound } from "@tanstack/react-router";

/**
 * The dashboard's catch-all.
 *
 * The Astro app rendered the dashboard SPA for *any* path (`[...page].astro`),
 * so an unknown path still ran the session-aware redirects and then rendered
 * the SPA's own not-found state. Keeping a splat under `/_dashboard` preserves
 * that: the gate above runs first (sign-in bounce, organization
 * canonicalization), and only then does the route report not-found.
 */
export const Route = createFileRoute("/_dashboard/$")({
  beforeLoad: () => {
    throw notFound();
  },
});

import * as Atom from "effect/unstable/reactivity/Atom";

import { PublicClient } from "./atom-rpc";

export type MergedPostTargetArgs = {
  readonly organizationId: string;
  readonly slug: string;
};

/**
 * Survivor slug for a publicly merged post, or null when the slug is not a
 * merged source. Mounted only when the post query misses, so the lookup never
 * runs for ordinary visits. One-shot point-in-time read: no SWR, the idle TTL
 * just dedups repeat visits to the same old slug.
 */
export const mergedPostTargetAtom = Atom.family((args: MergedPostTargetArgs) =>
  PublicClient.query("PostResolveMergedPublic", {
    organizationId: args.organizationId,
    slug: args.slug,
  }).pipe(Atom.setIdleTTL("5 minutes"))
);

import * as Atom from "effect/reactivity/Atom";

import { DashboardClient } from "~/lib/atom-rpc";

export type PostSuggestionsArgs = {
  readonly excerpt: string;
  readonly organizationId: string;
  readonly postId: string;
  readonly title: string;
};

export type PostSuggestion = Atom.Success<
  ReturnType<typeof postSuggestionsAtom>
>[number];

/**
 * Duplicate candidates for one post via `GetPostSuggestions` — the same
 * embedding+lexical search the create form uses. Keyed per post; runs when a
 * consumer mounts (the merge picker), and the idle TTL keeps the result
 * around so re-opening the picker reuses it instead of re-running the search.
 * Deliberately no stale-while-revalidate: suggestions are a point-in-time
 * search, and refetching on window focus would burn rate-limited embedding
 * lookups for data the user is not looking at.
 */
export const postSuggestionsAtom = Atom.family((args: PostSuggestionsArgs) =>
  DashboardClient.query(
    "GetPostSuggestions",
    {
      content: args.excerpt,
      limit: 5,
      organizationId: args.organizationId,
      title: args.title,
    },
    { reactivityKeys: { postSuggestions: [args.postId] } }
  ).pipe(Atom.setIdleTTL("5 minutes"))
);

export const postMergeAtom = DashboardClient.mutation("MergePost");
export const postUnmergeAtom = DashboardClient.mutation("UnmergePost");

export type PostTrafficArgs = {
  readonly organizationId: string;
  readonly postId: string;
};

/**
 * The post's all-time view count and last-30-days breakdown.
 *
 * Separate from the post's collections on purpose: a view count is an aggregate
 * over the whole workspace's history, and the dashboard's collections are row
 * lists the browser filters (ADR 0026). The idle TTL keeps a re-opened post
 * from re-reading on every mount; the number is not expected to be live.
 */
export const postTrafficAtom = Atom.family((args: PostTrafficArgs) =>
  DashboardClient.query("GetPostTraffic", args).pipe(
    Atom.setIdleTTL("1 minute")
  )
);

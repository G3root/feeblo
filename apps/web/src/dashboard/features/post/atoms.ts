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

export type PostViewCountArgs = {
  readonly organizationId: string;
  readonly postId: string;
};

/**
 * The post's all-time view count, for the detail sidebar.
 *
 * Deliberately only the counter: the breakdowns are the analytics tab's read,
 * fetched when that tab is opened or prefetched. A count is an aggregate over
 * the workspace's history, so it is not part of the post's collections either
 * (ADR 0026).
 */
export const postViewCountAtom = Atom.family((args: PostViewCountArgs) =>
  DashboardClient.query("GetPostViewCount", args).pipe(
    Atom.setIdleTTL("1 minute")
  )
);

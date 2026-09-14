import * as Atom from "effect/unstable/reactivity/Atom";

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
 * Duplicate candidates for one post via `PostSuggestions` — the same
 * embedding+lexical search the create form uses. Keyed per post; runs when a
 * consumer mounts (the merge picker), and the idle TTL keeps the result
 * around so re-opening the picker reuses it instead of re-running the search.
 * Deliberately no stale-while-revalidate: suggestions are a point-in-time
 * search, and refetching on window focus would burn rate-limited embedding
 * lookups for data the user is not looking at.
 */
export const postSuggestionsAtom = Atom.family((args: PostSuggestionsArgs) =>
  DashboardClient.query(
    "PostSuggestions",
    {
      content: args.excerpt,
      limit: 5,
      organizationId: args.organizationId,
      title: args.title,
    },
    { reactivityKeys: { postSuggestions: [args.postId] } }
  ).pipe(Atom.setIdleTTL("5 minutes"))
);

export const postMergeAtom = DashboardClient.mutation("PostMerge");
export const postUnmergeAtom = DashboardClient.mutation("PostUnmerge");

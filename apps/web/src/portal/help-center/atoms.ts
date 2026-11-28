import type { THelpCenterArticleSearchPublic } from "@feeblo/domain/help-center-article/schema";
import * as Atom from "effect/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "@/lib/atom-rpc";

/**
 * The portal's help center reads, as Effect atoms.
 *
 * The dashboard's editor uses atoms because a body is server-authoritative; the
 * portal uses them for a different reason — the reader-facing reads are a
 * projection with no local mutation to reconcile, so a query cache buys nothing
 * that a keyed atom with stale-while-revalidate does not.
 *
 * Every atom is keyed by `organizationId` because the portal is served per
 * site, and the client is the same `DashboardClient` the dashboard uses: the
 * public RPCs are operations in the same group, and one client means one
 * protocol instance and one bundle.
 */

/**
 * What invalidates the portal's help center reads for a workspace.
 *
 * Shared by all of them so a write refreshes everything that could have moved.
 * Finer keys would be four caches to invalidate for one verdict, and a help
 * center is not read at a rate where the difference is measurable.
 */
export const helpCenterPublicReactivityKeys = (organizationId: string) => ({
  helpCenterPublic: [organizationId],
});

/**
 * What invalidates one reader's verdict on one workspace.
 *
 * Separate from the reads above because a vote changes two counts and nothing
 * else: refreshing the topics, the list, the article detail and every search
 * cache for one press would be four caches spent on a number the reader can
 * already see.
 */
export const helpCenterFeedbackReactivityKeys = (organizationId: string) => ({
  helpCenterFeedback: [organizationId],
});

export const helpCenterTopicsPublicAtom = Atom.family(
  (organizationId: string) =>
    DashboardClient.query(
      "ListHelpCenterTopicsPublic",
      { organizationId },
      { reactivityKeys: helpCenterPublicReactivityKeys(organizationId) }
    ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export const helpCenterArticlesPublicAtom = Atom.family(
  (organizationId: string) =>
    DashboardClient.query(
      "ListHelpCenterArticlesPublic",
      { organizationId },
      { reactivityKeys: helpCenterPublicReactivityKeys(organizationId) }
    ).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

/**
 * The portal's search arguments.
 *
 * Derived from the operation, with the branded id widened back to `string`: the
 * decoded payload carries `WorkspaceId`, and a React prop does not. `limit` is
 * dropped because the page never sends one — the server's default is the page
 * size.
 */
export type HelpCenterSearchAtomArgs = Readonly<
  Omit<THelpCenterArticleSearchPublic, "limit" | "organizationId"> & {
    readonly organizationId: string;
  }
>;

/**
 * The portal's search.
 *
 * Two nested families, so the cache is keyed by value: `Atom.family` compares an
 * object argument by identity, and a query string is exactly the kind of key
 * that should be compared by value. Typing is then a series of cache lookups
 * rather than a series of writes to one entry — a reader who deletes a character
 * and retypes it gets the earlier answer back instead of a spinner. The idle TTL
 * is shorter than the other reads because the key includes text that only exists
 * for as long as somebody is typing it.
 *
 * No stale-while-revalidate here, unlike the reads above. Those answer "what is
 * in the help center", so a revalidation on focus keeps them current; this one
 * answers "what matches this text", and only the text changing should ask again.
 */
const searchAtoms = Atom.family((organizationId: string) =>
  Atom.family((query: string) =>
    DashboardClient.query(
      "SearchHelpCenterArticlesPublic",
      { organizationId, query },
      { reactivityKeys: helpCenterPublicReactivityKeys(organizationId) }
    ).pipe(Atom.setIdleTTL("1 minute"))
  )
);

export const helpCenterSearchPublicAtom = (args: HelpCenterSearchAtomArgs) =>
  searchAtoms(args.organizationId)(args.query);

export type HelpCenterArticlePublicAtomArgs = {
  readonly organizationId: string;
  readonly slug: string;
};

/** Callers must memoize `args`: `Atom.family` keys on identity. */
export const helpCenterArticlePublicAtom = Atom.family(
  (args: HelpCenterArticlePublicAtomArgs) =>
    DashboardClient.query("GetHelpCenterArticlePublic", args, {
      reactivityKeys: helpCenterPublicReactivityKeys(args.organizationId),
    }).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type HelpCenterFeedbackAtomArgs = {
  readonly articleId: string;
  readonly organizationId: string;
  readonly visitorId: string | undefined;
};

/**
 * One article's tally, and this reader's verdict.
 *
 * Keyed by the visitor id as well as the article, because `mine` is part of the
 * answer: two readers sharing a cache entry would each see the other's verdict.
 * The id arrives after mount, so the caller gates on it rather than reading a
 * tally it cannot attribute.
 */
export const helpCenterArticleFeedbackAtom = Atom.family(
  (args: HelpCenterFeedbackAtomArgs) =>
    DashboardClient.query(
      "GetHelpCenterArticleFeedbackPublic",
      {
        articleId: args.articleId,
        organizationId: args.organizationId,
        visitorId: args.visitorId,
      },
      { reactivityKeys: helpCenterFeedbackReactivityKeys(args.organizationId) }
    ).pipe(Atom.setIdleTTL("5 minutes"))
);

/**
 * The verdict write.
 *
 * React Query's `setQueryData` is what refreshed the counts before. The
 * mutation's reactivity keys do it now, so the widget never writes a cache it
 * does not own — and the optimistic part of the interaction is the vote
 * machine's, which already flips the reader's intent and settles on the answer.
 */
export const setHelpCenterArticleFeedbackAtom = DashboardClient.mutation(
  "SetHelpCenterArticleFeedback"
);

/** The view beacon: fire-and-forget, with no cache to invalidate. */
export const addHelpCenterArticleViewAtom = DashboardClient.mutation(
  "AddHelpCenterArticleView"
);

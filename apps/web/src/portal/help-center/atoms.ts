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
      { reactivityKeys: helpCenterPublicReactivityKeys(args.organizationId) }
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

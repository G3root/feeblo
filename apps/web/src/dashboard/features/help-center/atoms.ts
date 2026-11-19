import type { THelpCenterAnalyticsRange } from "@feeblo/domain/help-center-article/schema";
import * as Atom from "effect/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/**
 * The editor's single-article read is Effect Atom, not `useQuery`.
 *
 * The rest of this feature reads through TanStack DB collections because their
 * rows are optimistic and live-updating. An article's *body* is neither: it is
 * fetched once when an editor opens it, written whole, and never patched by
 * another surface underneath the form. A collection row cannot carry it either
 * — the list's rows are summaries — so the read belongs to the atom layer the
 * webhook and API-key pages already use for server-authoritative data.
 */

/**
 * What invalidates a cached article read.
 *
 * A mutation carrying these keys refreshes the query without the caller naming
 * it, which is what removed the editor's manual cache surgery: a save no longer
 * has to know that a read exists.
 */
export const helpCenterArticleReactivityKeys = (organizationId: string) => ({
  helpCenterArticle: [organizationId],
});

export type HelpCenterArticleAtomArgs = {
  readonly id: string;
  readonly organizationId: string;
};

/**
 * One article, body included.
 *
 * Callers must memoize `args`: `Atom.family` keys on identity, so a fresh object
 * literal per render would be a fresh atom per render — and a fetch with it.
 */
export const helpCenterArticleAtom = Atom.family(
  (args: HelpCenterArticleAtomArgs) =>
    DashboardClient.query("GetHelpCenterArticle", args, {
      reactivityKeys: helpCenterArticleReactivityKeys(args.organizationId),
    }).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"))
);

/**
 * The editor's writes.
 *
 * Atom mutations rather than `fetchRpc` for one reason: they carry the
 * reactivity keys above, so the article atom refreshes itself instead of the
 * form reaching into a cache it does not own. The list collection is read-only
 * — its rows are summaries — so each write refetches it explicitly.
 */
export const createHelpCenterArticleAtom = DashboardClient.mutation(
  "CreateHelpCenterArticle"
);

export const updateHelpCenterArticleAtom = DashboardClient.mutation(
  "UpdateHelpCenterArticle"
);

export const deleteHelpCenterArticleAtom = DashboardClient.mutation(
  "DeleteHelpCenterArticle"
);

export type HelpCenterAnalyticsAtomArgs = {
  readonly organizationId: string;
  readonly range: THelpCenterAnalyticsRange;
};

/** The window the panel opens on. */
export const DEFAULT_HELP_CENTER_ANALYTICS_RANGE =
  "30d" satisfies THelpCenterAnalyticsRange;

/**
 * One window of help center traffic, verdicts and searches.
 *
 * Keyed by the window as well as the workspace, so switching the toggle is a
 * cache lookup rather than a refetch of the other two windows. It shares the
 * article reactivity key because a verdict cast on the portal changes what this
 * panel reports: the reader's own write should move the number they are looking
 * at.
 */
export const helpCenterAnalyticsAtom = Atom.family(
  (args: HelpCenterAnalyticsAtomArgs) =>
    DashboardClient.query("GetHelpCenterAnalytics", args, {
      reactivityKeys: helpCenterArticleReactivityKeys(args.organizationId),
    }).pipe(dashboardSWR("60 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type HelpCenterSearchAtomArgs = {
  readonly organizationId: string;
  readonly query: string;
};

/**
 * The dashboard's article search.
 *
 * A family keyed by the query, like the portal's, so a keystroke is a cache
 * lookup and a deleted character is an answer that already exists. It shares
 * the article reactivity key: renaming an article should refresh a search that
 * would have matched the old title.
 */
export const helpCenterSearchAtom = Atom.family(
  (args: HelpCenterSearchAtomArgs) =>
    DashboardClient.query("SearchHelpCenterArticles", args, {
      reactivityKeys: helpCenterArticleReactivityKeys(args.organizationId),
    }).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("1 minute"))
);

import type { TInsightsRange } from "@feeblo/domain/insights/schema";
import * as Atom from "effect/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/**
 * Refreshes every insights read for a workspace.
 *
 * A single key for the whole surface: the RPC returns every metric at once, so
 * there is one cache entry per window and nothing finer to invalidate.
 */
export const insightsReactivityKeys = (organizationId: string) => ({
  insights: [organizationId],
});

/**
 * The window the insights page opens on.
 *
 * Exported so the sidebar's intent prefetch mounts the exact atom the page
 * will read; warming a different range would be a request nobody reuses.
 */
export const DEFAULT_INSIGHTS_RANGE = "30d" satisfies TInsightsRange;

export type InsightsAtomArgs = {
  readonly organizationId: string;
  readonly range: TInsightsRange;
};

export const workspaceInsightsAtom = Atom.family((args: InsightsAtomArgs) =>
  DashboardClient.query("GetWorkspaceInsights", args, {
    reactivityKeys: insightsReactivityKeys(args.organizationId),
  }).pipe(dashboardSWR("60 seconds"), Atom.setIdleTTL("5 minutes"))
);

export type WorkspaceInsights = Atom.Success<
  ReturnType<typeof workspaceInsightsAtom>
>;

/**
 * The insights page's traffic section.
 *
 * A second atom, fetched in parallel with the insights read: post views do not
 * change when a post or a vote does, so they share neither a query nor a
 * reactivity key. The window is the page's own range.
 */
export type WorkspaceTrafficAtomArgs = {
  readonly organizationId: string;
  readonly range: TInsightsRange;
};

export const workspaceTrafficAtom = Atom.family(
  (args: WorkspaceTrafficAtomArgs) =>
    DashboardClient.query("GetWorkspaceTraffic", args).pipe(
      dashboardSWR("60 seconds"),
      Atom.setIdleTTL("5 minutes")
    )
);

export type WorkspaceTraffic = Atom.Success<
  ReturnType<typeof workspaceTrafficAtom>
>;

export type InsightsSummary = WorkspaceInsights["summary"];
export type InsightsPoint = WorkspaceInsights["volume"][number];
export type InsightsStatusSlice = WorkspaceInsights["statusMix"][number];
export type InsightsUntouchedPost = WorkspaceInsights["untouchedPosts"][number];
export type InsightsBoard = WorkspaceInsights["topBoards"][number];
export type InsightsTag = WorkspaceInsights["topTags"][number];
export type InsightsVoter = WorkspaceInsights["topVoters"][number];

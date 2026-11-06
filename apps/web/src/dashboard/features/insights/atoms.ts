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

export type InsightsSummary = WorkspaceInsights["summary"];
export type InsightsPoint = WorkspaceInsights["volume"][number];
export type InsightsStatusSlice = WorkspaceInsights["statusMix"][number];
export type InsightsUntouchedPost = WorkspaceInsights["untouchedPosts"][number];
export type InsightsBoard = WorkspaceInsights["topBoards"][number];
export type InsightsTag = WorkspaceInsights["topTags"][number];
export type InsightsVoter = WorkspaceInsights["topVoters"][number];

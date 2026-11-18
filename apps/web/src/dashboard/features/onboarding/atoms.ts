import * as Atom from "effect/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/**
 * The cache key for a workspace's onboarding read.
 *
 * Deleting a sample post is a `Post` mutation, so the `Post` writers that move
 * this count can invalidate it by name instead of guessing at the atom's
 * identity. Nothing invalidates it today — the count only ever falls, and the
 * stale-while-revalidate below notices within a few minutes — but a surface
 * that deletes a sample should refresh this rather than let the banner lie.
 */
export const onboardingReactivityKeys = (organizationId: string) => ({
  onboarding: [organizationId],
});

/**
 * How many sample posts a workspace still has.
 *
 * Keyed per workspace because the answer is a property of the workspace, not
 * of the reader: a member who joins after the samples were deleted sees zero,
 * which is the truth. The idle TTL keeps it around between visits to the
 * dashboard home without pinning one entry per workspace that was ever opened.
 */
export const workspaceOnboardingSummaryAtom = Atom.family(
  (organizationId: string) =>
    DashboardClient.query(
      "GetWorkspaceOnboardingSummary",
      { organizationId },
      { reactivityKeys: onboardingReactivityKeys(organizationId) }
    ).pipe(dashboardSWR("60 seconds"), Atom.setIdleTTL("10 minutes"))
);

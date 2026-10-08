import * as Atom from "effect/reactivity/Atom";

import { DashboardClient, dashboardSWR } from "~/lib/atom-rpc";

/**
 * Whether the signed-in user may create another workspace, the reason when
 * they may not, and the free workspaces the decision counted.
 *
 * The register page renders this directly; the workspace switcher reads the
 * same atom so a capped owner gets the reason as a toast instead of a page
 * that refuses them. Deleting a workspace is a better-auth call rather than a
 * DashboardClient mutation, so callers refresh this atom explicitly after one
 * succeeds.
 */
export const workspaceCreationStateAtom = DashboardClient.query(
  "WorkspaceCreationStateGet",
  void 0
).pipe(dashboardSWR("30 seconds"), Atom.setIdleTTL("5 minutes"));

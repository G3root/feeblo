import { useMemo, useState } from "react";

import { useOrgBoards } from "~/hooks/use-org-boards";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { usePublicSiteUrl, useSite } from "~/hooks/use-site";

import {
  buildWelcomeTourSteps,
  type WelcomeTourStep,
} from "../components/tour-steps";
import { WelcomeTourDialog } from "../components/welcome-tour-dialog";
import { useWelcomeTour } from "../hooks/use-welcome-tour";
import {
  hasCompletedWelcomeTour,
  hasPendingWelcomeTour,
} from "../lib/tour-storage";

/**
 * Opens the welcome tour on the first dashboard the reader lands on after
 * creating a workspace.
 *
 * Three pieces of state decide it, and only one of them is durable:
 *
 * - the register page leaves a flag in `sessionStorage` before it navigates;
 * - this workspace's completion flag lives in `localStorage`;
 * - both are read once, when the gate mounts, so a tour that is dismissed
 *   cannot reopen itself on the next render.
 *
 * The gate is also the only place that knows the workspace's name and public
 * address, which is why the steps are built here rather than in the machine:
 * the machine owns the rules between steps, and the copy belongs to whoever
 * can read the workspace.
 *
 * Mounted from the dashboard layout, so it also fires for a first visit that
 * deep-links past the home page.
 */
export function WelcomeTourGate() {
  const organizationId = useOrganizationId();
  const site = useSite();
  const boardUrl = usePublicSiteUrl();
  const boardQuery = useOrgBoards(organizationId);

  const boardNames = useMemo(
    () => (boardQuery.data ?? []).map((board) => board.name),
    [boardQuery.data]
  );

  // Read once. Re-reading on every render would let the dialog reopen after the
  // flag it just cleared, which is the bug `sessionStorage` is here to avoid.
  const [queued] = useState(
    () => hasPendingWelcomeTour() && !hasCompletedWelcomeTour(organizationId)
  );

  const steps = useMemo<WelcomeTourStep[]>(
    () =>
      buildWelcomeTourSteps({
        boardNames,
        boardUrl: boardUrl ?? null,
        workspaceName: site?.name ?? "your workspace",
      }),
    [boardNames, boardUrl, site?.name]
  );

  const stepIds = useMemo(() => steps.map((step) => step.id), [steps]);

  const tour = useWelcomeTour({
    organizationId,
    // The site row is what names the workspace. Opening before it resolves
    // would greet the reader with a placeholder and then rewrite the title.
    shouldOpen: queued && site !== undefined,
    stepIds,
  });

  return <WelcomeTourDialog steps={steps} tour={tour} />;
}

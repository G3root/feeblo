/**
 * Where a workspace's welcome tour has got to, across reloads and tabs.
 *
 * Two browser storages, because the two questions are different:
 *
 * - `sessionStorage` holds "this tab has a tour queued". The register page
 *   writes it immediately before navigating, the gate consumes it, and a
 *   reload of the dashboard resumes the tour instead of losing it.
 * - `localStorage` holds "this workspace's tour is done". It outlives the tab,
 *   so the tour is once per workspace rather than once per visit.
 *
 * Every read and write is guarded: these run in a client-only route, but a
 * storage call still throws in a private window and in a sandboxed iframe, and
 * a tour that cannot be remembered must not take the dashboard down with it.
 * The failure mode is the one that matters least — the tour shows again.
 */

const COMPLETED_PREFIX = "feeblo:welcome-tour-completed:";

/**
 * Keyed by workspace, not by reader.
 *
 * The tour is shown to whoever creates the workspace, and the workspace is the
 * thing the tour talks about: a second workspace is a second board, a second
 * roadmap and a second set of samples, so asking "has this one been seen" is
 * the right question. Keying by user would also silence the tour for a
 * workspace whose owner had already toured a different one.
 */
const completedKey = (organizationId: string) =>
  `${COMPLETED_PREFIX}${organizationId}`;

const PENDING_KEY = "feeblo:welcome-tour-pending";

const hasWindow = () => typeof window !== "undefined";

/** True when this workspace's tour has been finished, however it ended. */
export const hasCompletedWelcomeTour = (
  organizationId: string | null | undefined
): boolean => {
  if (!hasWindow() || !organizationId) {
    return false;
  }

  try {
    return window.localStorage.getItem(completedKey(organizationId)) === "1";
  } catch {
    return false;
  }
};

/** Records the tour as finished and drops the queue flag in this tab. */
export const markWelcomeTourCompleted = (organizationId: string): void => {
  if (!hasWindow()) {
    return;
  }

  try {
    window.localStorage.setItem(completedKey(organizationId), "1");
  } catch {
    // Quota or a blocked storage: the tour may show again, which is the
    // failure this module is designed to shrug at.
  }

  clearPendingWelcomeTour();
};

/**
 * Queues the tour for this tab.
 *
 * Called by the register page before it navigates, not by the gate: by the
 * time the dashboard mounts, the only durable evidence that this arrival
 * followed a workspace creation is the flag the previous page left behind.
 */
export const markPendingWelcomeTour = (): void => {
  if (!hasWindow()) {
    return;
  }

  try {
    window.sessionStorage.setItem(PENDING_KEY, "1");
  } catch {
    // Same trade as above: worst case the tour does not open.
  }
};

/** True when a tour is queued in this tab and has not been finished. */
export const hasPendingWelcomeTour = (): boolean => {
  if (!hasWindow()) {
    return false;
  }

  try {
    return window.sessionStorage.getItem(PENDING_KEY) === "1";
  } catch {
    return false;
  }
};

export const clearPendingWelcomeTour = (): void => {
  if (!hasWindow()) {
    return;
  }

  try {
    window.sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Nothing to recover: the completion flag already blocks the tour.
  }
};

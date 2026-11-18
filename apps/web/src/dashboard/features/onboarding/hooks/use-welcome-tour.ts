import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useMachine } from "@xstate/react";
import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  toWelcomeTourView,
  type WelcomeTourFinish,
  type WelcomeTourView,
  welcomeTourMachine,
} from "../lib/tour-machine";
import { markWelcomeTourCompleted } from "../lib/tour-storage";

/** What the dialog needs from the tour. */
export type WelcomeTour = {
  readonly back: () => void;
  readonly close: () => void;
  readonly goTo: (index: number) => void;
  readonly next: () => void;
  readonly view: WelcomeTourView;
};

type UseWelcomeTourArgs = {
  readonly organizationId: string;
  /**
   * Whether this arrival is one the tour should interrupt. The gate decides
   * this from the queue flag and the completion flag; the hook does not read
   * storage itself, so a caller can open the tour for a reason of its own
   * without a second source of truth.
   */
  readonly shouldOpen: boolean;
  readonly stepIds: readonly string[];
};

/**
 * The tour's lifecycle wired to the two things outside it: analytics and the
 * browser's memory of it.
 *
 * The machine holds the rules; this hook reports what happened and makes it
 * stick. Two effects, both keyed on a *transition* rather than a value:
 *
 * - entering a step reports it once per step, so going back and forward does
 *   not multiply the event;
 * - finishing writes the completion flag and reports how far the reader got.
 *   The ref is what makes that once per session instead of once per render,
 *   and it resets when `finished` goes back to `null` (the tour was reopened).
 *
 * Dependency order matters: the completion flag is written before the gate can
 * re-render, so a tour that finishes never reopens on the next tick.
 */
export function useWelcomeTour({
  organizationId,
  shouldOpen,
  stepIds,
}: UseWelcomeTourArgs): WelcomeTour {
  const [snapshot, send] = useMachine(welcomeTourMachine, {
    input: { stepIds },
  });

  // The machine's snapshot is a stable object between transitions, so the
  // view is derived once per transition rather than once per render: the
  // dialog re-subscribes its key listener when `tour` changes identity, and
  // a fresh object on every parent render would rebind it needlessly.
  const view = useMemo(() => toWelcomeTourView(snapshot), [snapshot]);
  const reportedSteps = useRef<ReadonlySet<string>>(new Set());
  const reportedFinish = useRef<WelcomeTourFinish | null>(null);

  useEffect(() => {
    if (!shouldOpen) {
      return;
    }

    send({ type: "OPEN" });
  }, [send, shouldOpen]);

  useEffect(() => {
    if (!view.open || view.stepId === null) {
      return;
    }

    if (reportedSteps.current.has(view.stepId)) {
      return;
    }

    reportedSteps.current = new Set([...reportedSteps.current, view.stepId]);
    trackEvent("welcome_tour_step_viewed", {
      step_id: view.stepId,
      step_index: view.stepIndex,
    });
  }, [view.open, view.stepId, view.stepIndex]);

  useEffect(() => {
    if (view.finished === null) {
      reportedFinish.current = null;

      return;
    }

    if (reportedFinish.current === view.finished) {
      return;
    }

    reportedFinish.current = view.finished;
    markWelcomeTourCompleted(organizationId);
    trackEvent("welcome_tour_finished", {
      action: view.finished,
      steps_viewed: view.viewedCount,
    });
  }, [organizationId, view.finished, view.viewedCount]);

  const back = useCallback(() => send({ type: "BACK" }), [send]);
  const close = useCallback(() => send({ type: "CLOSE" }), [send]);

  const goTo = useCallback(
    (index: number) => send({ type: "GO_TO", index }),
    [send]
  );

  const next = useCallback(() => send({ type: "NEXT" }), [send]);

  return useMemo(
    () => ({ back, close, goTo, next, view }),
    [back, close, goTo, next, view]
  );
}

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import {
  toWelcomeTourView,
  type WelcomeTourSnapshot,
  welcomeTourMachine,
} from "./tour-machine";

/**
 * The machine is the rules, so these tests drive it the way the dialog does:
 * open it, move, close it, and read the resulting view.
 *
 * No fake timers and no injected dependencies: the tour has neither a debounce
 * nor a request. What it does have is the pair of facts the old implementation
 * kept in `useState` — which step you are on, and which steps you have seen —
 * and three of the cases below are the ones a single counter cannot express.
 */

const STEP_IDS = ["welcome", "feedback", "roadmap"] as const;

const start = (stepIds: readonly string[] = STEP_IDS) =>
  createActor(welcomeTourMachine, { input: { stepIds } }).start();

const viewOf = (actor: ReturnType<typeof start>) =>
  toWelcomeTourView(
    // SAFETY: this is the live actor's own snapshot, which carries the
    // `matches` and `context` this module reads; the structural type exists
    // only because `@xstate/react` widens the snapshot's `status`.
    actor.getSnapshot() as WelcomeTourSnapshot
  );

describe("welcome tour machine", () => {
  it("starts closed, on no step", () => {
    const actor = start();

    expect(viewOf(actor).open).toBe(false);
    expect(viewOf(actor).stepId).toBeNull();
    expect(viewOf(actor).finished).toBeNull();
  });

  it("opens on the first step and records it as viewed", () => {
    const actor = start();
    actor.send({ type: "OPEN" });

    expect(viewOf(actor)).toMatchObject({
      open: true,
      stepId: "welcome",
      stepIndex: 0,
      viewedCount: 1,
      canGoBack: false,
      isLastStep: false,
    });
  });

  it("does not open when it has no steps", () => {
    const actor = start([]);
    actor.send({ type: "OPEN" });

    // A tour with nothing to show is not a tour. Opening it would present an
    // empty dialog whose only button closes it.
    expect(viewOf(actor).open).toBe(false);
  });

  it("advances one step at a time", () => {
    const actor = start();
    actor.send({ type: "OPEN" });
    actor.send({ type: "NEXT" });

    expect(viewOf(actor)).toMatchObject({
      open: true,
      stepId: "feedback",
      stepIndex: 1,
      viewedCount: 2,
      canGoBack: true,
    });
  });

  it("closes as completed when the last step continues", () => {
    const actor = start();
    actor.send({ type: "OPEN" });
    actor.send({ type: "NEXT" });
    actor.send({ type: "NEXT" });

    expect(viewOf(actor).isLastStep).toBe(true);

    actor.send({ type: "NEXT" });

    expect(viewOf(actor)).toMatchObject({
      open: false,
      finished: "completed",
      viewedCount: 3,
    });
  });

  it("closes as skipped when dismissed", () => {
    const actor = start();
    actor.send({ type: "OPEN" });
    actor.send({ type: "NEXT" });
    actor.send({ type: "CLOSE" });

    // Three steps exist; two were seen. The count is why the finish event can
    // report where someone stopped reading rather than just "skipped".
    expect(viewOf(actor)).toMatchObject({
      open: false,
      finished: "skipped",
      viewedCount: 2,
    });
  });

  it("keeps the viewed count honest when stepping backwards", () => {
    const actor = start();
    actor.send({ type: "OPEN" });
    actor.send({ type: "NEXT" });
    actor.send({ type: "NEXT" });
    actor.send({ type: "BACK" });
    actor.send({ type: "BACK" });

    // Going back does not un-view a step, and returning to one does not count
    // it twice: the set is what was entered, not how far the index moved.
    expect(viewOf(actor)).toMatchObject({ stepId: "welcome", viewedCount: 3 });
  });

  it("ignores back on the first step", () => {
    const actor = start();
    actor.send({ type: "OPEN" });
    actor.send({ type: "BACK" });

    // The footer swaps Back for Skip at index 0, so a stray Left arrow must
    // not dismiss the tour the reader is on.
    expect(viewOf(actor)).toMatchObject({ open: true, stepId: "welcome" });
  });

  it("jumps to the step a dot names, and clamps an out-of-range one", () => {
    const actor = start();
    actor.send({ type: "OPEN" });

    actor.send({ type: "GO_TO", index: 2 });
    expect(viewOf(actor)).toMatchObject({ stepId: "roadmap", viewedCount: 2 });

    actor.send({ type: "GO_TO", index: 99 });
    expect(viewOf(actor)).toMatchObject({
      stepId: "roadmap",
      isLastStep: true,
    });

    actor.send({ type: "GO_TO", index: -1 });
    expect(viewOf(actor)).toMatchObject({ stepId: "welcome" });
  });

  it("resets when reopened after finishing", () => {
    const actor = start();
    actor.send({ type: "OPEN" });
    actor.send({ type: "CLOSE" });
    expect(viewOf(actor).finished).toBe("skipped");

    actor.send({ type: "OPEN" });

    // A second viewing is a second session: it has not finished yet, and the
    // viewed set describes the run that is starting, not the one that ended.
    expect(viewOf(actor)).toMatchObject({
      open: true,
      stepId: "welcome",
      finished: null,
      viewedCount: 1,
    });
  });
});

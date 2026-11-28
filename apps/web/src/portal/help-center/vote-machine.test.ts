import { describe, expect, it } from "@effect/vitest";
import { createActor } from "xstate";

import {
  helpCenterVoteMachine,
  toHelpCenterVoteView,
  toVoteLoadedEvent,
  type HelpCenterTally,
} from "./vote-machine";

/**
 * The machine's job is to make four mutually exclusive readings of "what is
 * this reader looking at" unrepresentable as a combination, so these tests walk
 * the graph rather than the widget: which states are reachable, what a settle
 * clears, and what `CLOSE_REASON` returns to.
 *
 * The tally is context, so the tests also pin *which* answer is drawn: the
 * event's own tally replaces whatever came before, and a read that lands after
 * a verdict is dropped rather than undoing the press.
 */

const ALL = [
  "loading",
  "failed",
  "asking",
  "promptReason",
  "answeredHelpful",
  "answeredUnhelpful",
];

const tally = (
  mine: boolean | null,
  counts: { helpful?: number; notHelpful?: number } = {}
): HelpCenterTally => ({
  helpfulCount: counts.helpful ?? 0,
  mine,
  notHelpfulCount: counts.notHelpful ?? 0,
});

/** Drive a fresh actor through `events` and hand back its paused snapshot. */
const run = (
  ...events: ReadonlyArray<
    Parameters<ReturnType<typeof createActor>["send"]>[0]
  >
) => {
  const actor = createActor(helpCenterVoteMachine).start();

  for (const event of events) {
    actor.send(event);
  }

  const state = actor.getSnapshot();

  return {
    matches: (name: string) => state.matches(name),
    reason: state.context.reason,
    view: toHelpCenterVoteView(state),
  };
};

describe("help center vote machine", () => {
  it("starts loading, with nothing drawn as chosen", () => {
    const state = run();

    expect(state.matches("loading")).toBe(true);
    expect(state.view.ready).toBe(false);
    expect(state.view.verdict).toBeNull();
    expect(state.view.counts).toStrictEqual({ helpful: 0, notHelpful: 0 });
  });

  it("declares exactly the six states", () => {
    expect(Object.keys(helpCenterVoteMachine.states).sort()).toStrictEqual(
      [...ALL].sort()
    );
  });

  it("leaves loading for the state the server's verdict names", () => {
    expect(toVoteLoadedEvent(null)).toBe("LOADED_NONE");
    expect(toVoteLoadedEvent(true)).toBe("LOADED_HELPFUL");
    expect(toVoteLoadedEvent(false)).toBe("LOADED_UNHELPFUL");

    expect(run({ tally: tally(null), type: "LOADED_NONE" }).view).toMatchObject(
      {
        ready: true,
        verdict: null,
      }
    );
    expect(
      run({ tally: tally(true), type: "LOADED_HELPFUL" }).view
    ).toMatchObject({ verdict: true });
    expect(
      run({ tally: tally(false), type: "LOADED_UNHELPFUL" }).view
    ).toMatchObject({ verdict: false });
  });

  it("draws the counts the read carried", () => {
    const state = run({
      tally: tally(null, { helpful: 12, notHelpful: 3 }),
      type: "LOADED_NONE",
    });

    expect(state.view.counts).toStrictEqual({ helpful: 12, notHelpful: 3 });
  });

  it("opens the reason box as an unhelpful verdict, not as an overlay", () => {
    const state = run(
      { tally: tally(null), type: "LOADED_NONE" },
      { tally: tally(false, { notHelpful: 1 }), type: "SETTLED_UNHELPFUL" }
    );

    expect(state.matches("promptReason")).toBe(true);
    // The old shape had `showReason: true` and `verdict: null`; here the prompt
    // *is* an unhelpful verdict, because pressing No is what opened it.
    expect(state.view.verdict).toBe(false);
    expect(state.view.reasonOpen).toBe(true);
  });

  it("returns from the prompt to the unhelpful verdict, never to asking", () => {
    const state = run(
      { tally: tally(null), type: "LOADED_NONE" },
      { tally: tally(false), type: "SETTLED_UNHELPFUL" },
      { type: "CLOSE_REASON" }
    );

    expect(state.matches("answeredUnhelpful")).toBe(true);
    expect(state.view.reasonOpen).toBe(false);
  });

  it("clears the reason when the reader flips to helpful", () => {
    const state = run(
      { tally: tally(null), type: "LOADED_NONE" },
      { tally: tally(false), type: "SETTLED_UNHELPFUL" },
      { type: "SET_REASON", value: "The screenshots are stale." },
      { tally: tally(true), type: "SETTLED_HELPFUL" }
    );

    expect(state.matches("answeredHelpful")).toBe(true);
    // A reason explains the unhelpful vote it was written for, so the helpful
    // branch cannot carry one — that is the invariant a boolean could not hold.
    expect(state.reason).toBe("");
    expect(state.view.verdict).toBe(true);
  });

  it("clears the reason once an unhelpful verdict is submitted", () => {
    const state = run(
      { tally: tally(null), type: "LOADED_NONE" },
      { tally: tally(false), type: "SETTLED_UNHELPFUL" },
      { type: "SET_REASON", value: "Missing a step." },
      { tally: tally(false, { notHelpful: 1 }), type: "SETTLED_UNHELPFUL" }
    );

    expect(state.matches("answeredUnhelpful")).toBe(true);
    expect(state.reason).toBe("");
  });

  it("lets a helpful reader change their mind to unhelpful", () => {
    const state = run(
      { tally: tally(true), type: "LOADED_HELPFUL" },
      { tally: tally(false), type: "SETTLED_UNHELPFUL" }
    );

    // Pressing No from a helpful verdict opens the box, because the reader has
    // something to say about it.
    expect(state.matches("promptReason")).toBe(true);
  });

  it("accepts a verdict cast before the tally arrives", () => {
    const state = run({
      tally: tally(true, { helpful: 1 }),
      type: "SETTLED_HELPFUL",
    });

    expect(state.matches("answeredHelpful")).toBe(true);
  });

  it("reopens the box when a reader presses No again", () => {
    const state = run(
      { tally: tally(false), type: "LOADED_UNHELPFUL" },
      { tally: tally(false), type: "SETTLED_UNHELPFUL" }
    );

    expect(state.matches("promptReason")).toBe(true);
  });

  /**
   * The reason the tally is context and not a `useState` in the hook: the two
   * events that carry one have different owners, and the settle is the newer.
   */
  it("draws the settle's tally without waiting for a read", () => {
    const state = run(
      { tally: tally(null, { helpful: 4 }), type: "LOADED_NONE" },
      { tally: tally(true, { helpful: 5 }), type: "SETTLED_HELPFUL" }
    );

    expect(state.view.counts).toStrictEqual({ helpful: 5, notHelpful: 0 });
  });

  it("ignores a read that lands after the verdict", () => {
    const state = run(
      { tally: tally(null, { helpful: 4 }), type: "LOADED_NONE" },
      { tally: tally(true, { helpful: 5 }), type: "SETTLED_HELPFUL" },
      // The in-flight read was sent before the vote; adopting it now would
      // show the count the press already moved past.
      { tally: tally(null, { helpful: 4 }), type: "LOADED_NONE" }
    );

    expect(state.matches("answeredHelpful")).toBe(true);
    expect(state.view.counts).toStrictEqual({ helpful: 5, notHelpful: 0 });
  });

  it("shows nothing as chosen when the tally fails", () => {
    const state = run({ type: "TALLY_FAILED" });

    expect(state.matches("failed")).toBe(true);
    expect(state.view.failed).toBe(true);
    expect(state.view.ready).toBe(false);
    expect(state.view.verdict).toBeNull();
  });

  it("retries from failed into loading, then adopts the retried tally", () => {
    const retrying = run({ type: "TALLY_FAILED" }, { type: "RETRY" });

    expect(retrying.matches("loading")).toBe(true);
    expect(retrying.view.failed).toBe(false);
    expect(retrying.view.ready).toBe(false);

    const helpful = run(
      { type: "TALLY_FAILED" },
      { type: "RETRY" },
      { tally: tally(true), type: "LOADED_HELPFUL" }
    );

    expect(helpful.matches("answeredHelpful")).toBe(true);
    expect(helpful.view.failed).toBe(false);
    expect(helpful.view.ready).toBe(true);
    expect(helpful.view.verdict).toBe(true);
  });

  it("adopts a loaded tally that arrives without a retry", () => {
    const asking = run(
      { type: "TALLY_FAILED" },
      { tally: tally(null), type: "LOADED_NONE" }
    );

    const unhelpful = run(
      { type: "TALLY_FAILED" },
      { tally: tally(false), type: "LOADED_UNHELPFUL" }
    );

    expect(asking.matches("asking")).toBe(true);
    expect(asking.view.ready).toBe(true);
    expect(asking.view.verdict).toBeNull();
    expect(unhelpful.matches("answeredUnhelpful")).toBe(true);
    expect(unhelpful.view.verdict).toBe(false);
  });

  it("ignores TALLY_FAILED once a verdict is known", () => {
    const asking = run(
      { tally: tally(null), type: "LOADED_NONE" },
      { type: "TALLY_FAILED" }
    );

    const answered = run(
      { tally: tally(true), type: "LOADED_HELPFUL" },
      { type: "TALLY_FAILED" }
    );

    expect(asking.matches("asking")).toBe(true);
    expect(asking.view.failed).toBe(false);
    expect(answered.matches("answeredHelpful")).toBe(true);
    expect(answered.view.verdict).toBe(true);
  });
});

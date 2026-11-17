import { describe, expect, it } from "@effect/vitest";
import { createActor } from "xstate";

import {
  helpCenterVoteMachine,
  toHelpCenterVoteView,
  toVoteLoadedEvent,
} from "./vote-machine";

/**
 * The machine's job is to make four mutually exclusive readings of "what is
 * this reader looking at" unrepresentable as a combination, so these tests walk
 * the graph rather than the widget: which states are reachable, what a settle
 * clears, and what `CLOSE_REASON` returns to.
 */

const ALL = [
  "loading",
  "asking",
  "promptReason",
  "answeredHelpful",
  "answeredUnhelpful",
];

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
  });

  it("declares exactly the five states", () => {
    expect(Object.keys(helpCenterVoteMachine.states).sort()).toStrictEqual(
      [...ALL].sort()
    );
  });

  it("leaves loading for the state the server's verdict names", () => {
    expect(toVoteLoadedEvent(null)).toBe("LOADED_NONE");
    expect(toVoteLoadedEvent(true)).toBe("LOADED_HELPFUL");
    expect(toVoteLoadedEvent(false)).toBe("LOADED_UNHELPFUL");

    expect(run({ type: "LOADED_NONE" }).view).toMatchObject({
      ready: true,
      verdict: null,
    });
    expect(run({ type: "LOADED_HELPFUL" }).view).toMatchObject({
      verdict: true,
    });
    expect(run({ type: "LOADED_UNHELPFUL" }).view).toMatchObject({
      verdict: false,
    });
  });

  it("opens the reason box as an unhelpful verdict, not as an overlay", () => {
    const state = run({ type: "LOADED_NONE" }, { type: "SETTLED_UNHELPFUL" });

    expect(state.matches("promptReason")).toBe(true);
    // The old shape had `showReason: true` and `verdict: null`; here the prompt
    // *is* an unhelpful verdict, because pressing No is what opened it.
    expect(state.view.verdict).toBe(false);
    expect(state.view.reasonOpen).toBe(true);
  });

  it("returns from the prompt to the unhelpful verdict, never to asking", () => {
    const state = run(
      { type: "LOADED_NONE" },
      { type: "SETTLED_UNHELPFUL" },
      { type: "CLOSE_REASON" }
    );

    expect(state.matches("answeredUnhelpful")).toBe(true);
    expect(state.view.reasonOpen).toBe(false);
  });

  it("clears the reason when the reader flips to helpful", () => {
    const state = run(
      { type: "LOADED_NONE" },
      { type: "SETTLED_UNHELPFUL" },
      { type: "SET_REASON", value: "The screenshots are stale." },
      { type: "SETTLED_HELPFUL" }
    );

    expect(state.matches("answeredHelpful")).toBe(true);
    // A reason explains the unhelpful vote it was written for, so the helpful
    // branch cannot carry one — that is the invariant a boolean could not hold.
    expect(state.reason).toBe("");
    expect(state.view.verdict).toBe(true);
  });

  it("clears the reason once an unhelpful verdict is submitted", () => {
    const state = run(
      { type: "LOADED_NONE" },
      { type: "SETTLED_UNHELPFUL" },
      { type: "SET_REASON", value: "Missing a step." },
      { type: "SETTLED_UNHELPFUL" }
    );

    expect(state.matches("answeredUnhelpful")).toBe(true);
    expect(state.reason).toBe("");
  });

  it("lets a helpful reader change their mind to unhelpful", () => {
    const state = run(
      { type: "LOADED_HELPFUL" },
      { type: "SETTLED_UNHELPFUL" }
    );

    // Pressing No from a helpful verdict opens the box, because the reader has
    // something to say about it.
    expect(state.matches("promptReason")).toBe(true);
  });

  it("accepts a verdict cast before the tally arrives", () => {
    const state = run({ type: "SETTLED_HELPFUL" });

    expect(state.matches("answeredHelpful")).toBe(true);
  });

  it("reopens the box when a reader presses No again", () => {
    const state = run(
      { type: "LOADED_UNHELPFUL" },
      { type: "SETTLED_UNHELPFUL" }
    );

    expect(state.matches("promptReason")).toBe(true);
  });
});

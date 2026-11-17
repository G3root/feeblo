import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import {
  SAMPLE_VOTE_DELAY_MS,
  authPanelSampleVoteMachine,
} from "./auth-panel-sample-vote-machine";

/**
 * The panel's sample vote: `settling` until the board has arrived, `voted`
 * after. Both edges are asserted, because the panel's whole job is the moment
 * the vote lands — a state that never arrives is a broken illustration, and a
 * state that arrives immediately is one nobody sees.
 */
describe("auth panel sample vote machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const start = () => createActor(authPanelSampleVoteMachine).start();

  const hasVoted = (actor: ReturnType<typeof start>) =>
    actor.getSnapshot().matches("voted");

  it("starts before the sample vote and stays there until the delay elapses", async () => {
    const actor = start();

    expect(hasVoted(actor)).toBe(false);

    await vi.advanceTimersByTimeAsync(SAMPLE_VOTE_DELAY_MS - 1);
    expect(hasVoted(actor)).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(hasVoted(actor)).toBe(true);
  });

  it("stays voted once the vote has landed", async () => {
    const actor = start();

    await vi.advanceTimersByTimeAsync(SAMPLE_VOTE_DELAY_MS);
    await vi.advanceTimersByTimeAsync(SAMPLE_VOTE_DELAY_MS * 4);

    expect(hasVoted(actor)).toBe(true);
  });

  it("settles on demand, so a test need not wait for the delay", () => {
    const actor = start();

    actor.send({ type: "SETTLE" });

    expect(hasVoted(actor)).toBe(true);
  });
});

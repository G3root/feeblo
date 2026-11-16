import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import { upvoteBurstMachine } from "./upvote-burst-machine";

/**
 * The machine is the whole lifecycle, so these tests drive the actor the way
 * the trigger does: send `CAST`, let `after` elapse.
 *
 * The states are the assertion, not the timer: what a reader needs to know is
 * that a vote rings for a bounded time, that a second vote restarts it rather
 * than leaving the first one's deadline in charge, and that nothing rings
 * before anybody votes.
 */
describe("upvote burst machine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const start = () => createActor(upvoteBurstMachine).start();

  const isBursting = (actor: ReturnType<typeof start>) =>
    actor.getSnapshot().matches("bursting");

  it("does not ring before a vote", async () => {
    const actor = start();

    await vi.advanceTimersByTimeAsync(2000);

    expect(isBursting(actor)).toBe(false);
  });

  it("rings for the animation and then clears itself", async () => {
    const actor = start();

    actor.send({ type: "CAST" });
    expect(isBursting(actor)).toBe(true);

    await vi.advanceTimersByTimeAsync(380);
    expect(isBursting(actor)).toBe(true);

    await vi.advanceTimersByTimeAsync(60);
    expect(isBursting(actor)).toBe(false);
  });

  it("restarts the ring when a second vote lands mid-burst", async () => {
    const actor = start();

    actor.send({ type: "CAST" });
    await vi.advanceTimersByTimeAsync(300);

    // Re-entering `bursting` restarts `after`, so the ring the visitor just
    // asked for is the one that is playing.
    actor.send({ type: "CAST" });
    await vi.advanceTimersByTimeAsync(200);

    expect(isBursting(actor)).toBe(true);

    await vi.advanceTimersByTimeAsync(240);
    expect(isBursting(actor)).toBe(false);
  });
});

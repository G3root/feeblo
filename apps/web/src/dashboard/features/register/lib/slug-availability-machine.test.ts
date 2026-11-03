import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import {
  type SlugAvailabilityCheck,
  type SlugAvailabilitySnapshot,
  createSlugAvailabilityMachine,
  toSlugAvailability,
} from "./slug-availability-machine";

/**
 * The machine is the whole lifecycle, so these tests drive the actor the way
 * the field does: send `INPUT`, let the debounce elapse, answer the request.
 *
 * The checker is injected through the factory, so the interpreter, the timer
 * scheduling and the abort signal are all real. That matters: three of the
 * behaviours below — one request per burst of keystrokes, an aborted request
 * when the slug changes, and a settled answer that is dropped when the slug
 * changes again — are exactly the ones a pure `transition()` cannot show and a
 * module mock would let drift from production.
 */

type SlugCheckAnswer = {
  readonly available: boolean;
  readonly reason: string | null;
  readonly suggestion: string | null;
};

type PendingCheck = {
  readonly slug: string;
  readonly signal: AbortSignal;
  readonly settle: (answer: SlugCheckAnswer) => void;
  readonly abandon: (error: Error) => void;
};

const answered = (
  available: boolean,
  suggestion: string | null = null,
  reason: string | null = null
): SlugCheckAnswer => ({ available, reason, suggestion });

describe("slug availability machine", () => {
  let checks: PendingCheck[] = [];
  let machine: ReturnType<typeof createSlugAvailabilityMachine>;

  const check: SlugAvailabilityCheck = ({ slug }, signal) =>
    new Promise<SlugCheckAnswer>((settle, abandon) => {
      checks.push({ abandon, settle, signal, slug });
    });

  const start = () => createActor(machine).start();

  const availabilityOf = (actor: ReturnType<typeof start>) =>
    toSlugAvailability(
      // SAFETY: this is the live actor's own snapshot, which carries the
      // `matches` and `context` this module reads; the structural type exists
      // only because `@xstate/react` widens the snapshot's `status`.
      actor.getSnapshot() as SlugAvailabilitySnapshot
    );

  beforeEach(() => {
    checks = [];
    machine = createSlugAvailabilityMachine(check);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stays idle when the field is empty or disabled", async () => {
    const actor = start();

    actor.send({ type: "INPUT", enabled: true, slug: "" });
    actor.send({ type: "INPUT", enabled: false, slug: "acme-corp" });
    await vi.advanceTimersByTimeAsync(1000);

    expect(checks).toHaveLength(0);
    expect(availabilityOf(actor)).toStrictEqual({
      status: "idle",
      suggestion: null,
      reason: null,
    });
  });

  it("waits for the field to settle before asking", async () => {
    const actor = start();

    actor.send({ type: "INPUT", enabled: true, slug: "ac" });
    await vi.advanceTimersByTimeAsync(300);
    expect(checks).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(50);
    expect(checks.map((entry) => entry.slug)).toStrictEqual(["ac"]);
  });

  it("asks once for a burst of keystrokes, for the last slug typed", async () => {
    const actor = start();

    for (const slug of ["ac", "acm", "acme"]) {
      actor.send({ type: "INPUT", enabled: true, slug });
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(400);

    expect(checks.map((entry) => entry.slug)).toStrictEqual(["acme"]);
  });

  it("reports a free slug as available", async () => {
    const actor = start();

    actor.send({ type: "INPUT", enabled: true, slug: "acme-corp" });
    await vi.advanceTimersByTimeAsync(400);
    expect(availabilityOf(actor).status).toBe("checking");

    checks[0]?.settle(answered(true));
    await vi.advanceTimersByTimeAsync(0);

    expect(availabilityOf(actor)).toStrictEqual({
      status: "available",
      suggestion: null,
      reason: null,
    });
  });

  it("carries the suggestion and reason of a taken slug", async () => {
    const actor = start();

    actor.send({ type: "INPUT", enabled: true, slug: "acme-corp" });
    await vi.advanceTimersByTimeAsync(400);
    checks[0]?.settle(answered(false, "acme-corp-2", "slug is taken"));
    await vi.advanceTimersByTimeAsync(0);

    expect(availabilityOf(actor)).toStrictEqual({
      status: "taken",
      suggestion: "acme-corp-2",
      reason: "slug is taken",
    });
  });

  it("reports a failed check as an error the field can retry", async () => {
    const actor = start();

    actor.send({ type: "INPUT", enabled: true, slug: "acme-corp" });
    await vi.advanceTimersByTimeAsync(400);
    checks[0]?.abandon(new Error("network"));
    await vi.advanceTimersByTimeAsync(0);

    expect(availabilityOf(actor).status).toBe("error");
  });

  it("aborts a request whose slug changed under it, and never shows its answer", async () => {
    const actor = start();

    actor.send({ type: "INPUT", enabled: true, slug: "acme-corp" });
    await vi.advanceTimersByTimeAsync(400);
    const superseded = checks[0];
    expect(superseded?.signal.aborted).toBe(false);

    actor.send({ type: "INPUT", enabled: true, slug: "acme-labs" });
    await vi.advanceTimersByTimeAsync(0);

    // Leaving `checking` stops the invoked actor, which aborts the request:
    // the superseded answer cannot land, so it cannot be rendered.
    expect(superseded?.signal.aborted).toBe(true);
    expect(availabilityOf(actor).status).toBe("idle");

    await vi.advanceTimersByTimeAsync(400);
    expect(checks.map((entry) => entry.slug)).toStrictEqual([
      "acme-corp",
      "acme-labs",
    ]);
  });

  it("drops a settled answer as soon as the slug changes again", async () => {
    const actor = start();

    actor.send({ type: "INPUT", enabled: true, slug: "acme-corp" });
    await vi.advanceTimersByTimeAsync(400);
    checks[0]?.settle(answered(false, "acme-corp-2"));
    await vi.advanceTimersByTimeAsync(0);
    expect(availabilityOf(actor).status).toBe("taken");

    actor.send({ type: "INPUT", enabled: true, slug: "acme-corp-3" });

    // The previous answer described a slug the user has stopped typing: it is
    // not shown again while the next check is pending.
    expect(availabilityOf(actor).status).toBe("idle");
  });
});

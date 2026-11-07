import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import {
  type CheckoutConfirmationSnapshot,
  createCheckoutConfirmationMachine,
  toCheckoutConfirmationStatus,
} from "./checkout-confirmation-machine";
import type { PlanType } from "./plans";

/**
 * The machine is the whole lifecycle, so these tests drive the actor the way
 * the success page does: start it with a checkout id, let the poll tick, and
 * answer the reads. The calls are injected through the factory, so the
 * interpreter, the `after` scheduling and the actor cancellation are all real.
 *
 * The behaviours worth pinning are the ones the old `setInterval` arranged by
 * hand: the first read is immediate, ten empty reads mean "delayed", a stalled
 * read has a deadline instead of hanging the page, a failed read is a retryable
 * error that does not abort an in-flight confirmation, and a confirmation
 * failure does not stop the webhook from being picked up by the poll.
 */

type Actor = ReturnType<typeof createActor>;

const statusOf = (actor: Actor) =>
  toCheckoutConfirmationStatus(
    // SAFETY: this is the live actor's own snapshot, which carries the
    // `matches` this module reads; the structural type exists only because
    // `@xstate/react` widens the snapshot's `status`.
    actor.getSnapshot() as CheckoutConfirmationSnapshot
  );

describe("checkout confirmation machine", () => {
  let confirmCalls: { checkoutId: string | null; organizationId: string }[];
  let confirmSignals: AbortSignal[];
  let confirmCompleted: number;
  let holdConfirm: boolean;
  let pendingConfirms: (() => void)[];
  let plan: PlanType | undefined;
  let confirmError: Error | null;
  let refetchError: Error | null;
  let refetchCount: number;
  let stalledRefetch: boolean;
  let machine: ReturnType<typeof createCheckoutConfirmationMachine>;

  beforeEach(() => {
    confirmCalls = [];
    confirmSignals = [];
    confirmCompleted = 0;
    holdConfirm = false;
    pendingConfirms = [];
    plan = undefined;
    confirmError = null;
    refetchError = null;
    refetchCount = 0;
    stalledRefetch = false;
    machine = createCheckoutConfirmationMachine({
      confirmCheckout: async (input, signal) => {
        confirmCalls.push(input);
        confirmSignals.push(signal);
        if (holdConfirm) {
          await new Promise<void>((resolve) => pendingConfirms.push(resolve));
        }
        if (confirmError) {
          throw confirmError;
        }
        confirmCompleted += 1;
      },
      readPlan: () => plan,
      refetchPlan: async () => {
        refetchCount += 1;
        if (stalledRefetch) {
          // Never settles: the invoke's `timeout` is the only way out.
          await new Promise<void>(() => undefined);
          return;
        }
        if (refetchError) {
          const error = refetchError;
          refetchError = null;
          throw error;
        }
      },
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const start = ({
    checkoutId = "checkout_1",
    paidPlan,
  }: {
    checkoutId?: string | null;
    paidPlan?: PlanType;
  } = {}) =>
    createActor(machine, {
      input: { checkoutId, organizationId: "org_1", plan: paidPlan },
    }).start();

  it("starts confirmed when the page already sees a paid plan", () => {
    const actor = start({ paidPlan: "professional" });

    expect(statusOf(actor)).toBe("confirmed");
    expect(confirmCalls).toHaveLength(0);
    expect(refetchCount).toBe(0);
  });

  it("stays hidden when the page has no checkout to confirm", () => {
    const actor = start({ checkoutId: null });

    expect(statusOf(actor)).toBe("hidden");
    expect(confirmCalls).toHaveLength(0);
    expect(refetchCount).toBe(0);
  });

  it("renders the seeded answer before the actor starts", () => {
    // `useMachine` starts the actor in an effect, so the first paint still holds
    // the idle snapshot. The alert must already say pending (or confirmed, when
    // the page loaded with a paid plan) rather than appear a frame later.
    const pending = createActor(machine, {
      input: {
        checkoutId: "checkout_1",
        organizationId: "org_1",
        plan: undefined,
      },
    });
    expect(statusOf(pending)).toBe("pending");

    const paid = createActor(machine, {
      input: {
        checkoutId: "checkout_1",
        organizationId: "org_1",
        plan: "starter",
      },
    });
    expect(statusOf(paid)).toBe("confirmed");
  });

  it("confirms once and polls until the plan lands", async () => {
    const actor = start();
    expect(statusOf(actor)).toBe("pending");

    // The confirmation and the first plan read start in parallel; the read is
    // immediate rather than one interval later.
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmCalls).toHaveLength(1);
    expect(refetchCount).toBe(1);
    expect(statusOf(actor)).toBe("pending");

    plan = "starter";
    await vi.advanceTimersByTimeAsync(3000);
    expect(refetchCount).toBe(2);
    expect(statusOf(actor)).toBe("confirmed");
  });

  it("settles as delayed after ten empty reads, then stops polling", async () => {
    const actor = start();
    await vi.advanceTimersByTimeAsync(0);

    // The first read already happened; nine more intervals make ten.
    for (let attempt = 1; attempt < 10; attempt++) {
      await vi.advanceTimersByTimeAsync(3000);
    }

    expect(refetchCount).toBe(10);
    expect(statusOf(actor)).toBe("delayed");

    await vi.advanceTimersByTimeAsync(10_000);
    expect(refetchCount).toBe(10);
  });

  it("counts a stalled read as an attempt and still settles as delayed", async () => {
    stalledRefetch = true;
    const actor = start();
    await vi.advanceTimersByTimeAsync(0);

    // Ten attempts, each ending in the 10s deadline, with a 3s wait between
    // nine of them. The tenth settles delayed instead of waiting again.
    await vi.advanceTimersByTimeAsync(10 * 10_000 + 9 * 3000 + 1000);

    expect(refetchCount).toBe(10);
    expect(statusOf(actor)).toBe("delayed");
  });

  it("keeps an in-flight confirmation alive when a read fails", async () => {
    refetchError = new Error("network");
    holdConfirm = true;
    const actor = start();
    await vi.advanceTimersByTimeAsync(0);

    // The poll error is a page-level error, but it stays inside `active`: the
    // confirmation actor is not stopped, so its upsert can still land.
    expect(statusOf(actor)).toBe("error");
    expect(confirmSignals[0]?.aborted).toBe(false);

    pendingConfirms[0]?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(confirmCompleted).toBe(1);
    expect(confirmSignals[0]?.aborted).toBe(false);
  });

  it("surfaces a failed read as an error the page can retry", async () => {
    refetchError = new Error("network");
    const actor = start();
    await vi.advanceTimersByTimeAsync(0);

    expect(statusOf(actor)).toBe("error");

    plan = "professional";
    actor.send({ type: "RETRY" });
    await vi.advanceTimersByTimeAsync(0);

    // The retry re-runs both the confirmation and the read, so a webhook that
    // landed while the page was in `error` is picked up as well.
    expect(confirmCalls).toHaveLength(2);
    expect(statusOf(actor)).toBe("confirmed");
  });

  it("keeps polling when the confirmation RPC fails", async () => {
    confirmError = new Error("Polar unavailable");
    const actor = start();
    await vi.advanceTimersByTimeAsync(0);

    // The webhook is still the durable path; a failed fast path must not turn
    // a paid checkout into an error the buyer can never clear.
    expect(statusOf(actor)).toBe("pending");

    plan = "starter";
    await vi.advanceTimersByTimeAsync(3000);
    expect(statusOf(actor)).toBe("confirmed");
  });
});

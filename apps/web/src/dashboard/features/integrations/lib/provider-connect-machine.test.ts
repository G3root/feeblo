import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActor } from "xstate";

import {
  PROVIDER_REDIRECT_TIMEOUT_MS,
  type ProviderConnectSnapshot,
  providerConnectMachine,
  toProviderConnectStatus,
} from "./provider-connect-machine";

/**
 * The graph is context-free and has no invoked children, so these tests drive
 * the real actor only for the `redirecting` timeout. Everything else is the
 * transition the button sends.
 */

describe("provider connect machine", () => {
  const statusOf = (actor: ReturnType<typeof start>) =>
    toProviderConnectStatus(
      // SAFETY: this is the live actor's own snapshot, which carries the
      // `matches` this module reads; the structural type exists only because
      // `@xstate/react` widens the snapshot's `status`.
      actor.getSnapshot() as ProviderConnectSnapshot
    );

  const start = () => createActor(providerConnectMachine).start();

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the button enabled", () => {
    expect(statusOf(start())).toBe("idle");
  });

  it("disables the button while the authorize URL is being requested", () => {
    const actor = start();

    actor.send({ type: "REQUEST" });

    expect(statusOf(actor)).toBe("requesting");
  });

  it("moves to redirecting once the URL arrives", () => {
    const actor = start();

    actor.send({ type: "REQUEST" });
    actor.send({ type: "AUTHORIZED" });

    expect(statusOf(actor)).toBe("redirecting");
  });

  it("re-enables the button when the request fails", () => {
    // The toast carries the message, so the only thing the graph owes the user
    // is a button they can press again.
    const actor = start();

    actor.send({ type: "REQUEST" });
    actor.send({ type: "FAILED" });

    expect(statusOf(actor)).toBe("idle");
  });

  it("recovers when the navigation never happens", async () => {
    // The behaviour the boolean could not express: a blocked or ignored
    // `window.location.assign` used to leave the page on a disabled
    // "Opening GitHub…" button until a manual reload.
    const actor = start();

    actor.send({ type: "REQUEST" });
    actor.send({ type: "AUTHORIZED" });

    await vi.advanceTimersByTimeAsync(PROVIDER_REDIRECT_TIMEOUT_MS - 1);
    expect(statusOf(actor)).toBe("redirecting");

    await vi.advanceTimersByTimeAsync(1);
    expect(statusOf(actor)).toBe("idle");
  });

  it("ignores a second request while the first is in flight", () => {
    // The button is disabled in `requesting`, so this is about the graph
    // agreeing with the UI rather than about a reachable click: a double
    // request must not queue a second navigation.
    const actor = start();

    actor.send({ type: "REQUEST" });
    actor.send({ type: "REQUEST" });

    expect(statusOf(actor)).toBe("requesting");
  });

  it("lets the user start over after the timeout", async () => {
    const actor = start();

    actor.send({ type: "REQUEST" });
    actor.send({ type: "AUTHORIZED" });
    await vi.advanceTimersByTimeAsync(PROVIDER_REDIRECT_TIMEOUT_MS);

    actor.send({ type: "REQUEST" });
    expect(statusOf(actor)).toBe("requesting");
  });
});

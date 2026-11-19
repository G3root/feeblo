import { describe, expect, it } from "@effect/vitest";
import { createActor } from "xstate";

import {
  importStartMachine,
  type ImportStartSnapshot,
  toImportStartPhase,
} from "./import-start-machine";

/**
 * The machine exists to make "starting", "failed" and "staged" mutually
 * exclusive, so these tests walk the graph rather than the dialog: which event
 * leaves each state, what a failure keeps, and what a retry clears.
 */
const start = () => createActor(importStartMachine).start();

const phaseOf = (actor: ReturnType<typeof start>) =>
  toImportStartPhase(
    // SAFETY: this is the live actor's own snapshot, which has the `matches`
    // this module reads; the structural type exists for `@xstate/react`'s
    // widened snapshot.
    actor.getSnapshot() as ImportStartSnapshot
  );

describe("import start machine", () => {
  it("starts idle and cannot stage without a request", () => {
    const actor = start();

    expect(phaseOf(actor)).toBe("idle");
    actor.send({ type: "STAGED" });
    expect(phaseOf(actor)).toBe("idle");
  });

  it("moves to starting and then staged", () => {
    const actor = start();

    actor.send({ type: "START" });
    expect(phaseOf(actor)).toBe("starting");

    actor.send({ type: "STAGED" });
    expect(phaseOf(actor)).toBe("staged");
  });

  it("keeps the server's message when starting fails", () => {
    const actor = start();

    actor.send({ type: "START" });
    actor.send({ type: "FAILED", message: "Canny rejected the API key." });

    expect(phaseOf(actor)).toBe("failed");
    expect(actor.getSnapshot().context.error).toBe(
      "Canny rejected the API key."
    );
  });

  it("retries from a fresh idle, clearing the old message", () => {
    const actor = start();
    actor.send({ type: "START" });
    actor.send({ type: "FAILED", message: "Nope" });

    actor.send({ type: "RETRY" });

    expect(phaseOf(actor)).toBe("idle");
    expect(actor.getSnapshot().context.error).toBeNull();
  });

  it("allows a direct retry while failed", () => {
    const actor = start();
    actor.send({ type: "START" });
    actor.send({ type: "FAILED", message: "Nope" });

    actor.send({ type: "START" });

    expect(phaseOf(actor)).toBe("starting");
  });

  it("has no way out of staged", () => {
    const actor = start();
    actor.send({ type: "START" });
    actor.send({ type: "STAGED" });

    actor.send({ type: "START" });
    actor.send({ type: "FAILED", message: "Too late" });

    expect(phaseOf(actor)).toBe("staged");
  });
});

import { describe, expect, it } from "vitest";
import { createActor, transition } from "xstate";

import {
  type PasswordResetSnapshot,
  passwordResetMachine,
  toPasswordResetStep,
} from "./password-reset-machine";

/**
 * The graph is context-free of I/O and has no invoked children, so these tests
 * read it through `transition()` against a resolved snapshot — the same view the
 * component has, without an interpreter.
 */

const at = (value: "otp" | "password", otp = "") =>
  passwordResetMachine.resolveState({ context: { otp }, value });

const stepOf = (snapshot: ReturnType<typeof at>) =>
  toPasswordResetStep(
    // SAFETY: this is a machine snapshot, which carries the `matches` and
    // `context` this module reads; the structural type exists only because
    // `@xstate/react` widens the snapshot's `status`.
    snapshot as PasswordResetSnapshot
  );

describe("password reset machine", () => {
  it("starts on the code step with no code held", () => {
    expect(stepOf(at("otp"))).toStrictEqual({ step: "otp" });
  });

  it("carries the verified code into the password step", () => {
    const [next] = transition(passwordResetMachine, at("otp"), {
      type: "VERIFIED",
      otp: "123456",
    });

    expect(stepOf(next)).toStrictEqual({ step: "password", otp: "123456" });
  });

  it("ignores a verification on the password step", () => {
    // The OTP form is unmounted there, so this is the graph agreeing with the
    // UI rather than a reachable event: a second verification must not swap the
    // code out from under a submit that is already in flight.
    const before = at("password", "123456");
    const [next] = transition(passwordResetMachine, before, {
      type: "VERIFIED",
      otp: "999999",
    });

    expect(next).toBe(before);
  });

  it("returns to the code step when the code is rejected, and forgets it", () => {
    const [next] = transition(passwordResetMachine, at("password", "123456"), {
      type: "CODE_REJECTED",
    });

    // Clearing the code is the point: the next `VERIFIED` must supply a fresh
    // one, so an expired code cannot be re-submitted by the back-edge.
    expect(stepOf(next)).toStrictEqual({ step: "otp" });
  });

  it("does not leave the code step when there is nothing to reject", () => {
    const before = at("otp");
    const [next] = transition(passwordResetMachine, before, {
      type: "CODE_REJECTED",
    });

    expect(next).toBe(before);
  });

  it("reaches the password step through the real actor", () => {
    // `transition()` above covers the cells; this is the one assertion that the
    // machine starts where it says it does.
    const actor = createActor(passwordResetMachine).start();

    actor.send({ type: "VERIFIED", otp: "123456" });

    expect(
      toPasswordResetStep(
        // SAFETY: as above — the live actor's own snapshot.
        actor.getSnapshot() as PasswordResetSnapshot
      )
    ).toStrictEqual({ step: "password", otp: "123456" });
  });
});

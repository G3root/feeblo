import { describe, expect, it } from "@effect/vitest";
import {
  EMAIL_OUTBOX_STATES,
  type TEmailOutboxState,
} from "@feeblo/domain-contracts/email";

import {
  EMAIL_INTENT_EVENTS,
  EMAIL_INTENT_STATES,
  LEGACY_EMAIL_INTENT_STATES,
  emailIntentMachine,
  sourceStatesFor,
  targetStateFor,
} from "./intent-machine";

/**
 * The machine is the declaration of the intent lifecycle, so these tests pin
 * what the generated SQL depends on: the edge list, each event's sources and
 * target, and the fact that the one legacy state stays drain-only.
 */

const ALL = EMAIL_OUTBOX_STATES;
const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

const isLegacy = (state: TEmailOutboxState) =>
  LEGACY_EMAIL_INTENT_STATES.includes(state);

/** True when some event takes `from` to `to`. */
const canMove = (from: TEmailOutboxState, to: TEmailOutboxState): boolean =>
  EMAIL_INTENT_EVENTS.some(
    (event) =>
      sourceStatesFor(event).includes(from) && targetStateFor(event) === to
  );

describe("email intent machine", () => {
  it("declares every state the stored vocabulary allows", () => {
    expect([...EMAIL_INTENT_STATES].sort()).toStrictEqual([...ALL].sort());
  });

  it("starts pending", () => {
    expect(emailIntentMachine.getInitialSnapshot().value).toBe("pending");
  });

  it("allows exactly the documented transitions", () => {
    const allowed = pairs.filter(([from, to]) => canMove(from, to));

    expect(allowed).toStrictEqual([
      ["pending", "materialized"],
      ["pending", "failed"],
      ["pending", "expired"],
      ["paused_by_plan", "pending"],
      ["paused_by_plan", "failed"],
      ["paused_by_plan", "expired"],
    ]);
  });

  it("derives each event's sources from that graph", () => {
    expect(sourceStatesFor("materialize")).toStrictEqual(["pending"]);
    expect(sourceStatesFor("expire")).toStrictEqual([
      "pending",
      "paused_by_plan",
    ]);
    expect(sourceStatesFor("fail")).toStrictEqual([
      "pending",
      "paused_by_plan",
    ]);
    expect(sourceStatesFor("resume")).toStrictEqual(["paused_by_plan"]);
  });

  it("gives every event exactly one target, so it can be a SET", () => {
    expect(EMAIL_INTENT_EVENTS.map(targetStateFor)).toStrictEqual([
      "expired",
      "failed",
      "materialized",
      "pending",
    ]);
  });

  it("reaches every state except the legacy one", () => {
    const reached = new Set<TEmailOutboxState>(["pending"]);
    let grew = true;

    while (grew) {
      grew = false;
      for (const from of EMAIL_INTENT_STATES) {
        if (!reached.has(from)) {
          continue;
        }
        for (const to of ALL) {
          if (!reached.has(to) && canMove(from, to)) {
            reached.add(to);
            grew = true;
          }
        }
      }
    }

    expect([...reached].sort()).toStrictEqual(
      ALL.filter((state) => !isLegacy(state)).sort()
    );
  });

  it("never re-introduces an edge into the legacy state", () => {
    // `paused_by_plan` exists because rows may still hold it, and the queue
    // resumes one it finds. Nothing may put a row back: members are no longer
    // plan-gated. An edge added later fails here.
    const inbound = ALL.filter((from) => canMove(from, "paused_by_plan"));

    expect(inbound).toStrictEqual([]);
  });

  it("treats only the three outcomes as terminal", () => {
    const terminal = ALL.filter(
      (state) => !ALL.some((to) => to !== state && canMove(state, to))
    );

    expect(terminal).toStrictEqual(["materialized", "failed", "expired"]);
  });
});

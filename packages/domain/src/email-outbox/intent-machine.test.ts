import { describe, expect, it } from "@effect/vitest";
import {
  EMAIL_OUTBOX_STATES,
  type TEmailOutboxState,
} from "@feeblo/domain-contracts/email";

import {
  EMAIL_INTENT_EVENTS,
  EMAIL_INTENT_STATES,
  emailIntentMachine,
  sourceStatesFor,
  targetStateFor,
} from "./intent-machine";

/**
 * The machine is the declaration of the intent lifecycle, so these tests pin
 * what the generated SQL depends on: the edge list, each event's sources and
 * target. Every write starts from `pending`; the machine has one source state
 * for every event.
 */

const ALL = EMAIL_OUTBOX_STATES;
const pairs = ALL.flatMap((from) => ALL.map((to) => [from, to] as const));

/** True when some event takes `from` to `to`. */
const canMove = (from: TEmailOutboxState, to: TEmailOutboxState): boolean =>
  EMAIL_INTENT_EVENTS.some(
    (event) =>
      sourceStatesFor(event).includes(from) && targetStateFor(event) === to
  );

describe("email intent machine", () => {
  it("declares every state the stored vocabulary allows", () => {
    // `EMAIL_INTENT_STATES` is an alias of the vocabulary, so comparing the
    // two proves nothing. The machine's own keys are the thing that can drift.
    expect(Object.keys(emailIntentMachine.states).sort()).toStrictEqual(
      [...ALL].sort()
    );
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
    ]);
  });

  it("derives each event's sources from that graph", () => {
    expect(sourceStatesFor("expire")).toStrictEqual(["pending"]);
    expect(sourceStatesFor("fail")).toStrictEqual(["pending"]);
    expect(sourceStatesFor("materialize")).toStrictEqual(["pending"]);
  });

  it("gives every event exactly one target, so it can be a SET", () => {
    expect(EMAIL_INTENT_EVENTS.map(targetStateFor)).toStrictEqual([
      "expired",
      "failed",
      "materialized",
    ]);
  });

  it("reaches every state", () => {
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

    expect([...reached].sort()).toStrictEqual([...ALL].sort());
  });

  it("treats only the three outcomes as terminal", () => {
    const terminal = ALL.filter(
      (state) => !ALL.some((to) => to !== state && canMove(state, to))
    );

    expect(terminal).toStrictEqual(["materialized", "failed", "expired"]);
  });
});

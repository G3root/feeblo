import {
  EMAIL_OUTBOX_STATES,
  type TEmailOutboxState,
} from "@feeblo/domain-contracts/email";
import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

/**
 * The lifecycle of one email intent, as an XState machine.
 *
 * An intent is the durable "we owe someone an email" row. Its state used to be
 * decided by `markIntentState`, which took the target state as an argument and
 * picked the legal sources with a ternary inside its `WHERE` builder:
 *
 * ```ts
 * state === "expired" || state === "failed"
 *   ? inArray(state, ["pending", "paused_by_plan"])
 *   : eq(state, "pending")
 * ```
 *
 * Read quickly, that says "failed and expired may come from paused jobs, the
 * rest only from pending". The machine that replaced it only needed one source:
 * plan-gating on the intent path is gone, along with the `paused_by_plan` state
 * and the drain path that walked rows out of it — this deployment holds no rows
 * in either. Every write now starts from `pending`.
 */
export const EMAIL_INTENT_EVENTS = ["expire", "fail", "materialize"] as const;

export type TEmailIntentEvent = (typeof EMAIL_INTENT_EVENTS)[number];

export const emailIntentMachine = setupEffect({
  schemas: {
    events: {
      expire: Schema.Struct({ type: Schema.Literal("expire") }),
      fail: Schema.Struct({ type: Schema.Literal("fail") }),
      materialize: Schema.Struct({ type: Schema.Literal("materialize") }),
    },
  },
}).createMachine({
  context: {},
  id: "emailIntent",
  initial: "pending",
  states: {
    // Written by the outbox writer and drained by the reconciliation sweep.
    pending: {
      on: {
        expire: { target: "expired" },
        fail: { target: "failed" },
        materialize: { target: "materialized" },
      },
    },
    // Terminal: its deliveries exist, whether or not they were sent.
    materialized: {},
    // Terminal: the intent's infrastructure budget was spent.
    failed: {},
    // Terminal: `expires_at` passed before the intent materialized.
    expired: {},
  },
});

/** Every state the machine declares, in declaration order. */
export const EMAIL_INTENT_STATES = EMAIL_OUTBOX_STATES;

const snapshotFor = (state: TEmailOutboxState) =>
  emailIntentMachine.resolveState({ context: {}, value: state });

/**
 * The state `event` leaves `state` in. An event a state does not handle
 * returns the state it started in: every state here has distinct targets, so
 * "unchanged" means "rejected".
 */
const stateAfter = (
  state: TEmailOutboxState,
  event: TEmailIntentEvent
): TEmailOutboxState => {
  const [next] = transition(emailIntentMachine, snapshotFor(state), {
    type: event,
  });
  // SAFETY: the machine is flat — every state and target is one of the
  // `EmailOutboxState` members — and `intent-machine.test.ts` walks the whole
  // graph rather than trusting this comment.
  return next.value as TEmailOutboxState;
};

/** True when the machine handles `event` at all, self-transitions included. */
const handles = (
  state: TEmailOutboxState,
  event: TEmailIntentEvent
): boolean => {
  const before = snapshotFor(state);
  return !isUnhandled(
    before,
    transition(emailIntentMachine, before, { type: event })
  );
};

/**
 * The states from which `event` moves the intent.
 *
 * This is what the repository's `WHERE` is built from, so a transition cannot
 * be written without naming where it may start.
 */
export const sourceStatesFor = (
  event: TEmailIntentEvent
): readonly TEmailOutboxState[] =>
  EMAIL_INTENT_STATES.filter((state) => handles(state, event));

/** The `SET` a transition writes: the single state `event` produces. */
export const targetStateFor = (event: TEmailIntentEvent): TEmailOutboxState => {
  const targets = EMAIL_INTENT_STATES.filter(
    (state) => stateAfter(state, event) !== state
  ).map((state) => stateAfter(state, event));
  const [target, ...rest] = [...new Set(targets)];

  if (target === undefined || rest.length > 0) {
    // An event that lands in two places cannot be a `SET` expression, and one
    // that lands nowhere is not a transition. `intent-machine.test.ts` asserts
    // exactly one target per event; this guard keeps a future edge from
    // silently picking the first.
    throw new Error(
      `Email intent event "${event}" must have exactly one target, found ${targets.length}`
    );
  }

  return target;
};

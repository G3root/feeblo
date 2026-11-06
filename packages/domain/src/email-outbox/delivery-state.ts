import type { TEmailDeliveryState } from "@feeblo/domain-contracts/email";
import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

/**
 * The lifecycle of one email delivery, as an XState machine.
 *
 * This was the table the other machines were modelled on, and it stays the
 * pattern: every guard in `repository.ts` is generated from
 * `deliverySourceStatesFor`, so a transition cannot be written without naming
 * where it may start. What changes here is only the idiom — `email-outbox/`
 * held this file's hand-written table next to `intent-machine.ts`, one for each
 * half of the same pipeline.
 *
 * There is exactly one source of truth in this file: the machine below. Every
 * event is named after the state it enters, so a target names its own
 * transition and no mapping table has to be kept beside it; the state list and
 * the transition reverse-index are both read back off the machine.
 */

export const emailDeliveryMachine = setupEffect({
  schemas: {
    events: {
      accepted: Schema.Struct({ type: Schema.Literal("accepted") }),
      bounced: Schema.Struct({ type: Schema.Literal("bounced") }),
      deferred: Schema.Struct({ type: Schema.Literal("deferred") }),
      delivered: Schema.Struct({ type: Schema.Literal("delivered") }),
      expired: Schema.Struct({ type: Schema.Literal("expired") }),
      failed: Schema.Struct({ type: Schema.Literal("failed") }),
      no_organization_access: Schema.Struct({
        type: Schema.Literal("no_organization_access"),
      }),
      queued: Schema.Struct({ type: Schema.Literal("queued") }),
      sending: Schema.Struct({ type: Schema.Literal("sending") }),
      suppressed: Schema.Struct({ type: Schema.Literal("suppressed") }),
    },
  },
}).createMachine({
  context: {},
  id: "emailDelivery",
  initial: "queued",
  states: {
    queued: {
      on: {
        // A deferral can arrive before the claim is visible (an untyped read
        // failure), and both deferral writers accept a queued row. Without
        // this edge `canTransitionDelivery("queued", "deferred")` answered
        // false while the SQL performed the move.
        deferred: { target: "deferred" },
        expired: { target: "expired" },
        failed: { target: "failed" },
        no_organization_access: { target: "no_organization_access" },
        sending: { target: "sending" },
        suppressed: { target: "suppressed" },
      },
    },
    // The provider call is in flight. Every ending is possible, including the
    // ambiguous ones a crash leaves behind.
    sending: {
      on: {
        accepted: { target: "accepted" },
        bounced: { target: "bounced" },
        deferred: { target: "deferred" },
        delivered: { target: "delivered" },
        expired: { target: "expired" },
        failed: { target: "failed" },
        no_organization_access: { target: "no_organization_access" },
        suppressed: { target: "suppressed" },
      },
    },
    // The provider has the message; only a provider event resolves it.
    accepted: {
      on: {
        bounced: { target: "bounced" },
        deferred: { target: "deferred" },
        delivered: { target: "delivered" },
        failed: { target: "failed" },
      },
    },
    // A soft or undetermined bounce is retried, and a retry re-sends.
    deferred: {
      on: {
        expired: { target: "expired" },
        failed: { target: "failed" },
        no_organization_access: { target: "no_organization_access" },
        sending: { target: "sending" },
        suppressed: { target: "suppressed" },
      },
    },
    delivered: {},
    bounced: {},
    failed: {},
    suppressed: {},
    expired: {},
    no_organization_access: {},
  },
});

/**
 * The states the machine declares, read off the machine.
 *
 * `EMAIL_DELIVERY_STATES` in `@feeblo/domain-contracts` is the stored
 * vocabulary and `delivery-state.test.ts` pins the two equal, so this cannot
 * drift into a second list.
 */
// SAFETY: the machine declares exactly the states of the delivery vocabulary
// (`delivery-state.test.ts` pins the two sets equal); `Object.keys` widens a
// record's keys to `string` because the standard library does not preserve
// them.
const deliveryStates: readonly TEmailDeliveryState[] = Object.keys(
  emailDeliveryMachine.states
) as readonly TEmailDeliveryState[];

const snapshotFor = (state: TEmailDeliveryState) =>
  emailDeliveryMachine.resolveState({ context: {}, value: state });

/**
 * True when `state` handles the event that enters `to`.
 *
 * `isUnhandled` rather than a value comparison: a self-transition leaves the
 * value unchanged while still being a move, and comparing values would report
 * it as rejected.
 */
const handles = (
  state: TEmailDeliveryState,
  to: TEmailDeliveryState
): boolean => {
  const before = snapshotFor(state);
  return !isUnhandled(
    before,
    transition(emailDeliveryMachine, before, { type: to })
  );
};

/** Returns whether a delivery may move between two persisted lifecycle states. */
export const canTransitionDelivery = (
  from: TEmailDeliveryState,
  to: TEmailDeliveryState
): boolean => from !== to && handles(from, to);

/** Persisted states from which a guarded SQL update may enter the target state. */
export const deliverySourceStatesFor = (
  to: TEmailDeliveryState
): readonly TEmailDeliveryState[] =>
  deliveryStates.filter((from) => from !== to && handles(from, to));

/**
 * The states in which an attempt may still own the delivery: not yet claimed,
 * being attempted, or waiting to be attempted again.
 *
 * Derived rather than written out. `deliverySourceStatesFor("sending")` is the
 * claimable pair, and the claim's own target — the event is named after the
 * state it enters, so `"sending"` is both — is the third. `accepted` is
 * deliberately absent: once the provider has the message only provider feedback
 * moves the delivery, and a terminal state is not work.
 *
 * Three writers used to spell this trio out by hand: the failed-attempt deferral
 * in `repository.ts`, the "oldest queued delivery" inspection in
 * `operations.ts`, and the "is this still workable" guard in `queue.ts`.
 */
export const deliveryInFlightStates: readonly TEmailDeliveryState[] = [
  ...deliverySourceStatesFor("sending"),
  "sending",
];

/** Terminal delivery states are safe no-ops when a workflow is replayed. */
export const isTerminalDeliveryState = (state: TEmailDeliveryState): boolean =>
  deliveryStates.every((to) => !handles(state, to));

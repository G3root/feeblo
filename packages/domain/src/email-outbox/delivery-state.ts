import type { TEmailDeliveryState } from "@feeblo/db/validation-schema/email";
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
 * The events are named after the state they enter because the writes are
 * target-driven: `markDeliveryOutcome(state)` and its siblings decide a target
 * and ask which rows may reach it, never the other way round.
 */

export const EMAIL_DELIVERY_EVENTS = [
  "accepted",
  "bounced",
  "deferred",
  "delivered",
  "expired",
  "failed",
  "noOrganizationAccess",
  "pausedByPlan",
  "queued",
  "sending",
  "suppressed",
] as const;

export type TEmailDeliveryEvent = (typeof EMAIL_DELIVERY_EVENTS)[number];

export const EMAIL_DELIVERY_STATES = [
  "queued",
  "sending",
  "accepted",
  "delivered",
  "deferred",
  "bounced",
  "failed",
  "suppressed",
  "paused_by_plan",
  "expired",
  "no_organization_access",
] as const satisfies readonly TEmailDeliveryState[];

export const emailDeliveryMachine = setupEffect({
  schemas: {
    events: {
      accepted: Schema.Struct({ type: Schema.Literal("accepted") }),
      bounced: Schema.Struct({ type: Schema.Literal("bounced") }),
      deferred: Schema.Struct({ type: Schema.Literal("deferred") }),
      delivered: Schema.Struct({ type: Schema.Literal("delivered") }),
      expired: Schema.Struct({ type: Schema.Literal("expired") }),
      failed: Schema.Struct({ type: Schema.Literal("failed") }),
      noOrganizationAccess: Schema.Struct({
        type: Schema.Literal("noOrganizationAccess"),
      }),
      pausedByPlan: Schema.Struct({ type: Schema.Literal("pausedByPlan") }),
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
        expired: { target: "expired" },
        failed: { target: "failed" },
        noOrganizationAccess: { target: "no_organization_access" },
        pausedByPlan: { target: "paused_by_plan" },
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
        noOrganizationAccess: { target: "no_organization_access" },
        pausedByPlan: { target: "paused_by_plan" },
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
        noOrganizationAccess: { target: "no_organization_access" },
        pausedByPlan: { target: "paused_by_plan" },
        sending: { target: "sending" },
        suppressed: { target: "suppressed" },
      },
    },
    // Reversible: the workspace's plan stopped allowing email.
    paused_by_plan: {
      on: {
        expired: { target: "expired" },
        queued: { target: "queued" },
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

/** The event that enters `to`. Every state here has exactly one. */
const eventFor = (to: TEmailDeliveryState): TEmailDeliveryEvent => {
  switch (to) {
    case "accepted":
      return "accepted";
    case "bounced":
      return "bounced";
    case "deferred":
      return "deferred";
    case "delivered":
      return "delivered";
    case "expired":
      return "expired";
    case "failed":
      return "failed";
    case "no_organization_access":
      return "noOrganizationAccess";
    case "paused_by_plan":
      return "pausedByPlan";
    case "queued":
      return "queued";
    case "sending":
      return "sending";
    case "suppressed":
      return "suppressed";
  }
};

const snapshotFor = (state: TEmailDeliveryState) =>
  emailDeliveryMachine.resolveState({ context: {}, value: state });

/** True when `state` handles `event`, including a self-transition. */
const handles = (state: TEmailDeliveryState, event: TEmailDeliveryEvent) => {
  const before = snapshotFor(state);
  return !isUnhandled(
    before,
    transition(emailDeliveryMachine, before, { type: event })
  );
};

/** Returns whether a delivery may move between two persisted lifecycle states. */
export const canTransitionDelivery = (
  from: TEmailDeliveryState,
  to: TEmailDeliveryState
): boolean => from !== to && handles(from, eventFor(to));

/** Persisted states from which a guarded SQL update may enter the target state. */
export const deliverySourceStatesFor = (
  to: TEmailDeliveryState
): readonly TEmailDeliveryState[] =>
  EMAIL_DELIVERY_STATES.filter(
    (from) => from !== to && handles(from, eventFor(to))
  );

/** Terminal delivery states are safe no-ops when a workflow is replayed. */
export const isTerminalDeliveryState = (state: TEmailDeliveryState): boolean =>
  !EMAIL_DELIVERY_EVENTS.some((event) => handles(state, event));

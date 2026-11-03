import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

import type {
  IntegrationConnectionLifecycleStatus,
  IntegrationDeliveryState,
} from "./integration-contracts";

/**
 * The two integration lifecycles, as XState machines.
 *
 * These graphs used to be two hand-written predicates whose only caller was
 * their own test. Nothing guarded a write with them, so every provider service
 * re-derived the same rules inline — and while writing the graphs out it turned
 * out the rules in the code and the rules in the predicate had drifted apart.
 *
 * Three drifts are fixed by saying what is true instead of what was intended:
 *
 * 1. **Only six states are ever persisted.** `reauth_required` and
 *    `disconnected` are never written; they appear in the column's type, in the
 *    vocabulary, and in three hand-written list filters, but no service stores
 *    them. They are kept here as {@link LEGACY_CONNECTION_LIFECYCLES} — states
 *    old rows may hold, with outgoing edges and none incoming — because deleting
 *    them would break reading a row that has one.
 * 2. **`disconnecting` goes straight to `archived`.** The old predicate said
 *    `disconnecting -> disconnected | revocation_unconfirmed`, skipping the fact
 *    that a successful disconnect archives. Every provider service does
 *    `disconnecting` then `archived`, so the predicate described a state nobody
 *    writes.
 * 3. **`archived` is the only terminal state.** Disconnect is allowed from
 *    anything else — each service's only precondition is "not archived" — and
 *    that same set is what the three list queries hard-code as seven names.
 *    {@link LISTED_CONNECTION_LIFECYCLES} derives it from the graph instead.
 *
 * A self-transition is deliberate: re-activating an already-`active` connection
 * is how a webhook endpoint's health counters are reset, and how a GitHub
 * installation restores itself. `isUnhandled` is what makes it visible to the
 * derivation below, since a self-transition leaves the value unchanged.
 */

export const INTEGRATION_CONNECTION_EVENTS = [
  "activate",
  "archive",
  "disconnect",
  "failRevocation",
  "pause",
] as const;

export type TIntegrationConnectionEvent =
  (typeof INTEGRATION_CONNECTION_EVENTS)[number];

/**
 * States old rows may hold and nothing writes any more. They keep outgoing
 * edges so a row that has one can still be disconnected or archived, and have
 * no incoming edge so nothing can create another one.
 */
export const LEGACY_CONNECTION_LIFECYCLES: readonly IntegrationConnectionLifecycleStatus[] =
  ["reauth_required", "disconnected"];

export const INTEGRATION_CONNECTION_STATES = [
  "connecting",
  "active",
  "paused",
  "reauth_required",
  "disconnecting",
  "disconnected",
  "revocation_unconfirmed",
  "archived",
] as const;

export const integrationConnectionMachine = setupEffect({
  schemas: {
    events: {
      activate: Schema.Struct({ type: Schema.Literal("activate") }),
      archive: Schema.Struct({ type: Schema.Literal("archive") }),
      disconnect: Schema.Struct({ type: Schema.Literal("disconnect") }),
      failRevocation: Schema.Struct({ type: Schema.Literal("failRevocation") }),
      pause: Schema.Struct({ type: Schema.Literal("pause") }),
    },
  },
}).createMachine({
  context: {},
  id: "integrationConnection",
  initial: "connecting",
  states: {
    // A row exists and OAuth has not completed. The only way out is a
    // successful callback, or the owner giving up and archiving it.
    connecting: {
      on: {
        activate: { target: "active" },
        archive: { target: "archived" },
        disconnect: { target: "disconnecting" },
      },
    },
    active: {
      on: {
        // Self: re-activating resets delivery health and restores a suspended
        // installation. It is a real event even though the state does not move.
        activate: { target: "active" },
        archive: { target: "archived" },
        disconnect: { target: "disconnecting" },
        pause: { target: "paused" },
      },
    },
    paused: {
      on: {
        activate: { target: "active" },
        archive: { target: "archived" },
        disconnect: { target: "disconnecting" },
      },
    },
    // Legacy. Nothing writes it, but a row that holds it can be archived or
    // disconnected, and reactivating it is what a completed reinstall does.
    reauth_required: {
      on: {
        activate: { target: "active" },
        archive: { target: "archived" },
        disconnect: { target: "disconnecting" },
      },
    },
    // Revocation is in flight: routes are disabled and pending deliveries are
    // canceled before the remote call.
    disconnecting: {
      on: {
        archive: { target: "archived" },
        failRevocation: { target: "revocation_unconfirmed" },
      },
    },
    // Legacy, as above.
    disconnected: {
      on: {
        activate: { target: "active" },
        archive: { target: "archived" },
      },
    },
    // The remote side could not be told. Nothing has been deleted, so a retry
    // is allowed to start the disconnect again.
    revocation_unconfirmed: {
      on: {
        archive: { target: "archived" },
        disconnect: { target: "disconnecting" },
      },
    },
    // Terminal: the row is a tombstone kept for its retention window.
    archived: {},
  },
});

const connectionSnapshot = (state: IntegrationConnectionLifecycleStatus) =>
  integrationConnectionMachine.resolveState({ context: {}, value: state });

/** True when the machine handles `event` at all, including a self-transition. */
const connectionHandles = (
  state: IntegrationConnectionLifecycleStatus,
  event: TIntegrationConnectionEvent
): boolean => {
  const before = connectionSnapshot(state);
  return !isUnhandled(
    before,
    transition(integrationConnectionMachine, before, { type: event })
  );
};

/** The states from which `event` moves or re-affirms the connection. */
export const connectionSourceStatesFor = (
  event: TIntegrationConnectionEvent
): readonly IntegrationConnectionLifecycleStatus[] =>
  INTEGRATION_CONNECTION_STATES.filter((state) =>
    connectionHandles(state, event)
  );

/** The state `event` produces, for a guarded `UPDATE`'s `SET`. */
export const connectionTargetStateFor = (
  event: TIntegrationConnectionEvent
): IntegrationConnectionLifecycleStatus => {
  const targets = new Set<IntegrationConnectionLifecycleStatus>();
  for (const state of INTEGRATION_CONNECTION_STATES) {
    if (!connectionHandles(state, event)) {
      continue;
    }
    const [next] = transition(
      integrationConnectionMachine,
      connectionSnapshot(state),
      {
        type: event,
      }
    );
    // SAFETY: the machine is flat and every target is one of the eight
    // connection states, which `lifecycle.test` walks end to end.
    targets.add(next.value as IntegrationConnectionLifecycleStatus);
  }
  const [target, ...rest] = [...targets];

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `Integration connection event "${event}" must have exactly one target, found ${targets.size}`
    );
  }

  return target;
};

/**
 * The states a connection list shows: every state except the tombstone.
 *
 * Each of Slack, Discord and Webhook wrote this out as the same seven names.
 * It is exactly the set {@link connectionSourceStatesFor}`("archive")` returns,
 * which is the point — a listed connection is one that can still be archived.
 */
export const LISTED_CONNECTION_LIFECYCLES: readonly IntegrationConnectionLifecycleStatus[] =
  connectionSourceStatesFor("archive");

export const INTEGRATION_DELIVERY_EVENTS = [
  "cancel",
  "exhaust",
  "lease",
  "release",
  "retry",
  "succeed",
] as const;

export type TIntegrationDeliveryEvent =
  (typeof INTEGRATION_DELIVERY_EVENTS)[number];

export const INTEGRATION_DELIVERY_STATES = [
  "pending",
  "leased",
  "succeeded",
  "exhausted",
  "canceled",
] as const;

export const integrationDeliveryMachine = setupEffect({
  schemas: {
    events: {
      cancel: Schema.Struct({ type: Schema.Literal("cancel") }),
      exhaust: Schema.Struct({ type: Schema.Literal("exhaust") }),
      lease: Schema.Struct({ type: Schema.Literal("lease") }),
      release: Schema.Struct({ type: Schema.Literal("release") }),
      retry: Schema.Struct({ type: Schema.Literal("retry") }),
      succeed: Schema.Struct({ type: Schema.Literal("succeed") }),
    },
  },
}).createMachine({
  context: {},
  id: "integrationDelivery",
  initial: "pending",
  states: {
    pending: {
      on: {
        cancel: { target: "canceled" },
        lease: { target: "leased" },
      },
    },
    leased: {
      on: {
        cancel: { target: "canceled" },
        exhaust: { target: "exhausted" },
        release: { target: "pending" },
        succeed: { target: "succeeded" },
      },
    },
    succeeded: {},
    // Terminal: the retry budget is spent. `retry` is the manual escape hatch.
    exhausted: {
      on: { retry: { target: "pending" } },
    },
    // Terminal: canceled work is never revived.
    canceled: {},
  },
});

const deliverySnapshot = (state: IntegrationDeliveryState) =>
  integrationDeliveryMachine.resolveState({ context: {}, value: state });

/** The states from which `event` moves a delivery. */
export const deliverySourceStatesFor = (
  event: TIntegrationDeliveryEvent
): readonly IntegrationDeliveryState[] =>
  INTEGRATION_DELIVERY_STATES.filter((state) => {
    // One snapshot for both halves: `isUnhandled` compares the snapshot it is
    // given with the one the transition started from, so building two would
    // report every event as handled.
    const before = deliverySnapshot(state);
    return !isUnhandled(
      before,
      transition(integrationDeliveryMachine, before, { type: event })
    );
  });

/** The state `event` produces, for a guarded `UPDATE`'s `SET`. */
export const deliveryTargetStateFor = (
  event: TIntegrationDeliveryEvent
): IntegrationDeliveryState => {
  const targets = new Set<IntegrationDeliveryState>();
  for (const state of deliverySourceStatesFor(event)) {
    const before = deliverySnapshot(state);
    const [next] = transition(integrationDeliveryMachine, before, {
      type: event,
    });
    // SAFETY: the delivery machine is flat and every target is one of the five
    // delivery states, which the test walks.
    targets.add(next.value as IntegrationDeliveryState);
  }
  const [target, ...rest] = [...targets];

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `Integration delivery event "${event}" must have exactly one target, found ${targets.size}`
    );
  }

  return target;
};

/** Tests whether a connection lifecycle transition is legal before persistence. */
export const canTransitionIntegrationConnectionLifecycle = ({
  from,
  to,
}: {
  readonly from: IntegrationConnectionLifecycleStatus;
  readonly to: IntegrationConnectionLifecycleStatus;
}): boolean =>
  INTEGRATION_CONNECTION_EVENTS.some(
    (event) =>
      connectionSourceStatesFor(event).includes(from) &&
      connectionTargetStateFor(event) === to
  );

/** Tests whether a delivery state change preserves lease and retry semantics. */
export const canTransitionIntegrationDeliveryState = ({
  from,
  to,
}: {
  readonly from: IntegrationDeliveryState;
  readonly to: IntegrationDeliveryState;
}): boolean =>
  INTEGRATION_DELIVERY_EVENTS.some(
    (event) =>
      deliverySourceStatesFor(event).includes(from) &&
      deliveryTargetStateFor(event) === to
  );

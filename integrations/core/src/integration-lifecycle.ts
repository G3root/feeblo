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
 * Every event is named after the state it enters, so a target names its own
 * transition. That is what lets the state list, the reverse index and the
 * predicates all be read back off the machines: there is one source of truth
 * per graph, and no mapping table beside it.
 *
 * A self-transition is deliberate: re-activating an already-`active` connection
 * is how a webhook endpoint's health counters are reset, and how a GitHub
 * installation restores itself. `isUnhandled` is what makes it visible to the
 * derivations below, since a self-transition leaves the value unchanged.
 */

/**
 * States old rows may hold and nothing writes any more. They keep outgoing
 * edges so a row that has one can still be disconnected or archived, and have
 * no incoming edge so nothing can create another one.
 */
export const LEGACY_CONNECTION_LIFECYCLES: readonly IntegrationConnectionLifecycleStatus[] =
  ["reauth_required", "disconnected"];

export const integrationConnectionMachine = setupEffect({
  schemas: {
    events: {
      active: Schema.Struct({ type: Schema.Literal("active") }),
      archived: Schema.Struct({ type: Schema.Literal("archived") }),
      disconnecting: Schema.Struct({ type: Schema.Literal("disconnecting") }),
      paused: Schema.Struct({ type: Schema.Literal("paused") }),
      revocation_unconfirmed: Schema.Struct({
        type: Schema.Literal("revocation_unconfirmed"),
      }),
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
        active: { target: "active" },
        archived: { target: "archived" },
        disconnecting: { target: "disconnecting" },
      },
    },
    active: {
      on: {
        // Self: re-activating resets delivery health and restores a suspended
        // installation. It is a real event even though the state does not move.
        active: { target: "active" },
        archived: { target: "archived" },
        disconnecting: { target: "disconnecting" },
        paused: { target: "paused" },
      },
    },
    paused: {
      on: {
        active: { target: "active" },
        archived: { target: "archived" },
        disconnecting: { target: "disconnecting" },
      },
    },
    // Legacy. Nothing writes it, but a row that holds it can be archived or
    // disconnected, and reactivating it is what a completed reinstall does.
    reauth_required: {
      on: {
        active: { target: "active" },
        archived: { target: "archived" },
        disconnecting: { target: "disconnecting" },
      },
    },
    // Revocation is in flight: routes are disabled and pending deliveries are
    // canceled before the remote call.
    disconnecting: {
      on: {
        archived: { target: "archived" },
        revocation_unconfirmed: { target: "revocation_unconfirmed" },
      },
    },
    // Legacy, as above.
    disconnected: {
      on: {
        active: { target: "active" },
        archived: { target: "archived" },
      },
    },
    // The remote side could not be told. Nothing has been deleted, so a retry
    // is allowed to start the disconnect again.
    revocation_unconfirmed: {
      on: {
        archived: { target: "archived" },
        disconnecting: { target: "disconnecting" },
      },
    },
    // Terminal: the row is a tombstone kept for its retention window.
    archived: {},
  },
});

export const integrationDeliveryMachine = setupEffect({
  schemas: {
    events: {
      canceled: Schema.Struct({ type: Schema.Literal("canceled") }),
      exhausted: Schema.Struct({ type: Schema.Literal("exhausted") }),
      leased: Schema.Struct({ type: Schema.Literal("leased") }),
      pending: Schema.Struct({ type: Schema.Literal("pending") }),
      succeeded: Schema.Struct({ type: Schema.Literal("succeeded") }),
    },
  },
}).createMachine({
  context: {},
  id: "integrationDelivery",
  initial: "pending",
  states: {
    pending: {
      on: {
        canceled: { target: "canceled" },
        leased: { target: "leased" },
      },
    },
    leased: {
      on: {
        canceled: { target: "canceled" },
        exhausted: { target: "exhausted" },
        pending: { target: "pending" },
        succeeded: { target: "succeeded" },
      },
    },
    succeeded: {},
    // Terminal: the retry budget is spent. `pending` is the manual escape hatch.
    exhausted: {
      on: { pending: { target: "pending" } },
    },
    // Terminal: canceled work is never revived.
    canceled: {},
  },
});

/**
 * The states one machine declares, read off the machine.
 *
 * `Object.keys` widens a record's keys to `string`; the SAFETY comment on each
 * cast states the invariant, and `lifecycle.test.ts` walks both graphs so a
 * mismatch fails rather than silently shortening a `WHERE ... IN`.
 */
export const INTEGRATION_CONNECTION_STATES: readonly IntegrationConnectionLifecycleStatus[] =
  // SAFETY: the machine declares exactly the connection lifecycle vocabulary.
  Object.keys(
    integrationConnectionMachine.states
  ) as readonly IntegrationConnectionLifecycleStatus[];

export const INTEGRATION_DELIVERY_STATES: readonly IntegrationDeliveryState[] =
  // SAFETY: the machine declares exactly the delivery state vocabulary.
  Object.keys(
    integrationDeliveryMachine.states
  ) as readonly IntegrationDeliveryState[];

/**
 * The states some edge enters. `connecting` is the initial state and has no
 * inbound edge, so it is not one of these — which is why asking for its sources
 * answers "none" rather than naming an event nothing accepts.
 */
const CONNECTION_TARGETS = [
  "active",
  "archived",
  "disconnecting",
  "paused",
  "revocation_unconfirmed",
] as const;

type TConnectionTarget = (typeof CONNECTION_TARGETS)[number];

const isConnectionTarget = (
  state: IntegrationConnectionLifecycleStatus
): state is TConnectionTarget =>
  CONNECTION_TARGETS.some((target) => target === state);

/**
 * True when the connection machine handles the event that enters `to` from
 * `from`.
 *
 * `isUnhandled` rather than a value comparison: re-activating an `active`
 * connection is a real event whose value does not change, and a comparison
 * would report it as rejected.
 */
const connectionHandles = (
  from: IntegrationConnectionLifecycleStatus,
  to: TConnectionTarget
): boolean => {
  const before = integrationConnectionMachine.resolveState({
    context: {},
    value: from,
  });
  return !isUnhandled(
    before,
    transition(integrationConnectionMachine, before, { type: to })
  );
};

/**
 * The same, for the delivery graph.
 *
 * Exported because it is the only way to observe a self-edge: every state
 * derivation here filters `from === to` out, so a test built on them cannot
 * tell "no edge" from "an edge that stays put".
 */
export const deliveryHandles = (
  from: IntegrationDeliveryState,
  to: IntegrationDeliveryState
): boolean => {
  const before = integrationDeliveryMachine.resolveState({
    context: {},
    value: from,
  });
  return !isUnhandled(
    before,
    transition(integrationDeliveryMachine, before, { type: to })
  );
};

/** The states from which `to` moves or re-affirms the connection. */
export const connectionSourceStatesFor = (
  to: IntegrationConnectionLifecycleStatus
): readonly IntegrationConnectionLifecycleStatus[] =>
  isConnectionTarget(to)
    ? INTEGRATION_CONNECTION_STATES.filter((from) =>
        connectionHandles(from, to)
      )
    : [];

/**
 * The states a connection list shows: every state except the tombstone.
 *
 * Each of Slack, Discord and Webhook wrote this out as the same seven names.
 * It is exactly the set that may still be archived, which is the point — a
 * listed connection is one that can still be archived.
 */
export const LISTED_CONNECTION_LIFECYCLES: readonly IntegrationConnectionLifecycleStatus[] =
  connectionSourceStatesFor("archived");

/** The states from which `to` moves a delivery. */
export const deliverySourceStatesFor = (
  to: IntegrationDeliveryState
): readonly IntegrationDeliveryState[] =>
  INTEGRATION_DELIVERY_STATES.filter(
    (from) => from !== to && deliveryHandles(from, to)
  );

/** Tests whether a connection lifecycle transition is legal before persistence. */
export const canTransitionIntegrationConnectionLifecycle = ({
  from,
  to,
}: {
  readonly from: IntegrationConnectionLifecycleStatus;
  readonly to: IntegrationConnectionLifecycleStatus;
}): boolean => isConnectionTarget(to) && connectionHandles(from, to);

/** Tests whether a delivery state change preserves lease and retry semantics. */
export const canTransitionIntegrationDeliveryState = ({
  from,
  to,
}: {
  readonly from: IntegrationDeliveryState;
  readonly to: IntegrationDeliveryState;
}): boolean => from !== to && deliveryHandles(from, to);

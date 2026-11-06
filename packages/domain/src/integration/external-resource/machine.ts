import {
  EXTERNAL_RESOURCE_CREATE_REQUEST_STATES,
  type TExternalResourceCreateRequestState,
} from "@feeblo/domain-contracts/integration";
import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

/**
 * The lifecycle of one user-requested external-resource creation, as an XState
 * machine.
 *
 * The row is an idempotency reservation: `pending` is committed before the
 * provider call, and `succeeded`/`failed` record what the call did. The three
 * guards that read it were written inline in
 * `integration/external-resource/live.ts` — `eq(state, "pending")` on both
 * endings, and two `existing.state === …` comparisons on the reservation lookup
 * — with nothing tying them together.
 *
 * Two things are deliberately *not* in the machine, and both are lease
 * predicates on an unchanged state rather than lifecycle moves:
 *
 * - A `pending` reservation older than `creationReservationStaleMs` is
 *   re-claimed **in place**: the row stays `pending` and only its `createdAt`
 *   moves, so a crash between the reservation and the provider call does not
 *   wedge the idempotency key. A self-transition would make "handled" and
 *   "rejected" indistinguishable in `sourceStatesFor`.
 * - A `failed` reservation is re-claimed as a fresh `pending`. That *is* a
 *   move, so it is `reclaim` below and its sources come from the graph.
 *
 * The machine is a definition, not an actor: the authoritative state is the
 * database row, and a second process must be able to resume it.
 */
export const EXTERNAL_RESOURCE_CREATE_REQUEST_EVENTS = [
  "fail",
  "reclaim",
  "succeed",
] as const;

export type TExternalResourceCreateRequestEvent =
  (typeof EXTERNAL_RESOURCE_CREATE_REQUEST_EVENTS)[number];

export const externalResourceCreateRequestMachine = setupEffect({
  schemas: {
    events: {
      fail: Schema.Struct({ type: Schema.Literal("fail") }),
      reclaim: Schema.Struct({ type: Schema.Literal("reclaim") }),
      succeed: Schema.Struct({ type: Schema.Literal("succeed") }),
    },
  },
}).createMachine({
  context: {},
  id: "externalResourceCreateRequest",
  initial: "pending",
  states: {
    // The reservation is committed; the provider call has not answered yet.
    pending: {
      on: {
        fail: { target: "failed" },
        succeed: { target: "succeeded" },
      },
    },
    // The provider call failed. A retry of the same idempotency key re-claims
    // the reservation rather than inserting a second one.
    failed: {
      on: {
        reclaim: { target: "pending" },
      },
    },
    // Terminal: the resource exists and the link is recorded.
    succeeded: {},
  },
});

/** A snapshot for a persisted state, built without starting an actor. */
const snapshotFor = (state: TExternalResourceCreateRequestState) =>
  externalResourceCreateRequestMachine.resolveState({
    context: {},
    value: state,
  });

/**
 * The state the machine lands in after `event` from `state`.
 *
 * An event a state does not handle returns the state it started in, which is
 * what makes `canTransitionCreateRequest` a two-state comparison: the machine
 * has no self-transitions, so "unchanged" means "rejected".
 */
const stateAfter = (
  state: TExternalResourceCreateRequestState,
  event: TExternalResourceCreateRequestEvent
): TExternalResourceCreateRequestState => {
  const [next] = transition(
    externalResourceCreateRequestMachine,
    snapshotFor(state),
    { type: event }
  );
  // SAFETY: the machine is flat — every state and target is one of the three
  // stored states — so a `StateValue` read from it is always a state.
  // `machine.test.ts` walks the whole graph rather than trusting this.
  return next.value as TExternalResourceCreateRequestState;
};

/**
 * True when the machine handles `event` at all.
 *
 * `isUnhandled` rather than comparing the resulting state to the starting one:
 * the two disagree on a self-transition, which leaves the value unchanged while
 * still being a move.
 */
const handles = (
  state: TExternalResourceCreateRequestState,
  event: TExternalResourceCreateRequestEvent
): boolean => {
  const before = snapshotFor(state);
  return !isUnhandled(
    before,
    transition(externalResourceCreateRequestMachine, before, { type: event })
  );
};

/** Every state from which `event` moves the request. */
export const sourceStatesFor = (
  event: TExternalResourceCreateRequestEvent
): readonly TExternalResourceCreateRequestState[] =>
  EXTERNAL_RESOURCE_CREATE_REQUEST_STATES.filter((from) =>
    handles(from, event)
  );

/** True when the machine permits `from --event--> to`. */
export const canTransitionCreateRequest = (
  from: TExternalResourceCreateRequestState,
  to: TExternalResourceCreateRequestState
): boolean =>
  from !== to &&
  EXTERNAL_RESOURCE_CREATE_REQUEST_EVENTS.some(
    (event) => stateAfter(from, event) === to
  );

/** Every state `event` can produce, deduplicated. */
const targetsOf = (
  event: TExternalResourceCreateRequestEvent
): readonly TExternalResourceCreateRequestState[] => {
  const targets = new Set<TExternalResourceCreateRequestState>();
  for (const from of EXTERNAL_RESOURCE_CREATE_REQUEST_STATES) {
    const next = stateAfter(from, event);
    // Only a move counts: an event a state does not handle returns that state,
    // and counting it would make the target ambiguous.
    if (next !== from) {
      targets.add(next);
    }
  }
  return [...targets];
};

/**
 * The single state `event` produces.
 *
 * Every event here has exactly one target, so a caller that knows the event
 * knows the `SET` half of its guarded update.
 */
export const targetStateFor = (
  event: TExternalResourceCreateRequestEvent
): TExternalResourceCreateRequestState => {
  const [target, ...rest] = targetsOf(event);

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `External resource create request event "${event}" must have exactly one target, found ${rest.length + 1}`
    );
  }

  return target;
};

/**
 * True when the request still holds a reservation the provider call may end.
 *
 * `succeed` and `fail` have the same sources, so this one predicate answers
 * both guarded updates instead of each writing its own `eq(state, "pending")`.
 */
export const isReservedCreateRequestState = (
  state: TExternalResourceCreateRequestState
): boolean => sourceStatesFor("succeed").includes(state);

/**
 * The state a reservation starts in.
 *
 * A fresh reservation and a re-claimed failure land in the same state, so this
 * is the `reclaim` target rather than a fourth name for it — `machine.test.ts`
 * pins the two together, and the machine's own initial state is that same
 * state.
 */
export const RESERVED_CREATE_REQUEST_STATE: TExternalResourceCreateRequestState =
  targetStateFor("reclaim");

/** True when a previous failure may be re-claimed as a fresh reservation. */
export const canReclaimCreateRequestState = (
  state: TExternalResourceCreateRequestState
): boolean => sourceStatesFor("reclaim").includes(state);

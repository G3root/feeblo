import {
  DATA_IMPORT_STATUSES,
  type TDataImportStatus,
} from "@feeblo/domain-contracts/data-import";
import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { isUnhandled, transition } from "xstate";

/**
 * The lifecycle of one import job, as an XState machine.
 *
 * Before this file the lifecycle was implicit: `data_import_job.status` held the
 * six names and five hand-written `WHERE status = ...` clauses decided which
 * moves were legal, in `repository.ts`, `worker.ts` and the dashboard. Nothing
 * tied those clauses to each other, so "may a canceled job be completed?" was
 * answerable only by reading every call site.
 *
 * The machine is the single declaration of the state graph. The database is
 * still the arbiter of the *row* — Postgres, not this object, decides whether a
 * claim wins a row — so the machine is deliberately used as a definition, not
 * run as a live actor. `createEffectActor` would put the authoritative state in
 * the worker's memory, which is the one place it must not live: a crashed
 * worker's job is recovered by whichever process next finds an expired lease.
 *
 * It is built with `setupEffect` because that is the repo's one schema dialect
 * for a lifecycle — the events below are Effect Schemas like every other stored
 * vocabulary — not because it needs an Effect interpreter. The machine
 * registers no Effect actions and no Effect actors, so `transition()` and
 * `resolveState()` read it exactly as they read any XState logic; if that ever
 * stops being true, starting it here becomes wrong, because the durable row, not
 * an in-memory snapshot, is what a restart must resume from.
 *
 * What the machine adds:
 *
 * - `sourceStatesFor` feeds the guarded SQL, so a transition cannot be written
 *   without naming the states it may start from (the pattern
 *   `email-outbox/delivery-state.ts` established for deliveries).
 * - `isTerminalDataImportStatus` replaces the three copies of the same
 *   `status === "awaiting_confirmation" || ...` predicate that had drifted
 *   across `domain-contracts`, the repository and the dashboard.
 * - `xstate/graph` can enumerate paths over the real graph in tests, so a
 *   forgotten edge is a failing test rather than a silent no-op `UPDATE`.
 *
 * Two things are deliberately *not* in the machine:
 *
 * - The lease (`leaseOwner`, `leaseExpiresAt`). Re-claiming a job whose lease
 *   expired keeps it `running`; the row does not move, so the lease is
 *   orthogonal metadata. It stays a SQL predicate on the `claim` candidate
 *   query, which is the only reader that needs it.
 * - The per-row outcomes. A `completed` job may still carry failed rows; that
 *   is the row report's business, not a different job state.
 */
export const DATA_IMPORT_JOB_EVENTS = [
  "cancel",
  "claim",
  "complete",
  "confirm",
  "fail",
] as const;

export type TDataImportJobEvent = (typeof DATA_IMPORT_JOB_EVENTS)[number];

/**
 * One schema per event, so `setupEffect` derives the event union the machine
 * accepts. Effect Schema is the repo's vocabulary everywhere else, which is why
 * this machine is built with `setupEffect` rather than XState's Standard-Schema
 * `setup`: there is no second schema dialect to learn or keep in step.
 */
const JOB_EVENT_SCHEMAS = {
  cancel: Schema.Struct({ type: Schema.Literal("cancel") }),
  claim: Schema.Struct({ type: Schema.Literal("claim") }),
  complete: Schema.Struct({ type: Schema.Literal("complete") }),
  confirm: Schema.Struct({ type: Schema.Literal("confirm") }),
  fail: Schema.Struct({ type: Schema.Literal("fail") }),
} as const;

export const dataImportJobMachine = setupEffect({
  schemas: {
    events: JOB_EVENT_SCHEMAS,
  },
}).createMachine({
  context: {},
  id: "dataImportJob",
  initial: "awaiting_confirmation",
  states: {
    // A staged job owns its workspace's import slot and writes nothing yet;
    // cancelling here just drops the staged rows.
    awaiting_confirmation: {
      on: {
        cancel: { target: "canceled" },
        confirm: { target: "queued" },
      },
    },
    // Confirmed, waiting for a worker. `claimNextJob` moves this to `running`.
    queued: {
      on: {
        cancel: { target: "canceled" },
        claim: { target: "running" },
      },
    },
    // The pass is live. `complete` and `fail` are the worker's two endings;
    // `cancel` can land mid-batch, which every write after it must respect.
    running: {
      on: {
        cancel: { target: "canceled" },
        complete: { target: "completed" },
        fail: { target: "failed" },
      },
    },
    // Terminal. A job in one of these no longer holds its workspace slot and
    // no event moves it.
    completed: {},
    failed: {},
    canceled: {},
  },
});

/** Every state the machine declares, in declaration order. */
export const DATA_IMPORT_JOB_STATES = DATA_IMPORT_STATUSES;

/**
 * A snapshot for a persisted status, so the pure transition function can be
 * asked about a state this process never visited. `resolveState` builds it
 * without starting an actor.
 */
const snapshotFor = (status: TDataImportStatus) =>
  dataImportJobMachine.resolveState({ context: {}, value: status });

/**
 * The status the machine lands in after `event` from `status`.
 *
 * An event a state does not handle returns the state it started in, which is
 * what makes `canTransition` a two-state comparison rather than a special
 * case: the machine has no self-transitions, so "unchanged" means "rejected".
 */
const statusAfter = (
  status: TDataImportStatus,
  event: TDataImportJobEvent
): TDataImportStatus => {
  const [next] = transition(dataImportJobMachine, snapshotFor(status), {
    type: event,
  });
  // SAFETY: the machine is flat — every state is a top-level string and every
  // target is one of the six `DataImportStatus` members — so a `StateValue`
  // read from it is always a status. The machine's own `satisfies` above is
  // what keeps that true, and `machine.test.ts` walks the whole graph to
  // confirm it rather than trusting this comment.
  return next.value as TDataImportStatus;
};

/**
 * True when the machine handles `event` at all.
 *
 * `isUnhandled` rather than comparing the resulting state to the starting one:
 * the two disagree on a self-transition, which leaves the value unchanged while
 * still being a move.
 */
const handles = (
  status: TDataImportStatus,
  event: TDataImportJobEvent
): boolean => {
  const before = snapshotFor(status);
  return !isUnhandled(
    before,
    transition(dataImportJobMachine, before, { type: event })
  );
};

/** True when the machine permits `from --event--> to`. */
export const canTransitionDataImportJob = (
  from: TDataImportStatus,
  to: TDataImportStatus
): boolean =>
  from !== to &&
  DATA_IMPORT_JOB_EVENTS.some((event) => statusAfter(from, event) === to);

/**
 * Every status from which `event` moves the job.
 *
 * This is what the repository's guarded `UPDATE`s are built from: the `WHERE`
 * that protects `cancelJob` is this function's answer for `cancel`, not a
 * second list that has to be kept in step by hand.
 */
export const sourceStatesFor = (
  event: TDataImportJobEvent
): readonly TDataImportStatus[] =>
  DATA_IMPORT_JOB_STATES.filter((from) => handles(from, event));

/** Every status `event` can produce from `from`, in declaration order. */
export const targetStatesFor = (
  from: TDataImportStatus
): readonly TDataImportStatus[] =>
  DATA_IMPORT_JOB_STATES.filter((to) => canTransitionDataImportJob(from, to));

/**
 * A terminal job no longer occupies its workspace's import slot and accepts no
 * event. This is the predicate that used to be duplicated three times.
 */
export const isTerminalDataImportStatus = (
  status: TDataImportStatus
): boolean => targetStatesFor(status).length === 0;

/** True while a staged import still occupies its workspace. */
export const isActiveDataImportStatus = (status: TDataImportStatus): boolean =>
  !isTerminalDataImportStatus(status);

/** True when the staged file may still be confirmed into a job. */
export const canConfirmDataImportStatus = (
  status: TDataImportStatus
): boolean => sourceStatesFor("confirm").includes(status);

/** True when a cancel request would move the job. */
export const canCancelDataImportStatus = (status: TDataImportStatus): boolean =>
  sourceStatesFor("cancel").includes(status);

import * as Schema from "effect/Schema";
import { setup } from "xstate";

/**
 * The lifecycle of one "start this import" action, as an XState machine.
 *
 * The source list has two ways to stage a job — a CSV upload and a provider
 * pull — and both hold the same four facts in four `useState` values: whether
 * the request is running, what the server said when it failed, whether a job
 * was staged, and whether the person has since dismissed the success. Those
 * four are not independent: a failure is impossible after a success, and a
 * success makes the form's button meaningless.
 *
 * The machine names that shape once. The request itself stays outside the
 * graph, because the thing that failed is known where the mutation rejects
 * and the message belongs beside the form rather than in the actor's context.
 * This file is therefore pure: a test can walk it with `transition()`.
 */

const StartEvent = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("START") })
);

const StagedEvent = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("STAGED") })
);

const RetryEvent = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("RETRY") })
);

const FailedEvent = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("FAILED"), message: Schema.String })
);

const ContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ error: Schema.NullOr(Schema.String) })
);

export const importStartMachine = setup({
  schemas: {
    context: ContextSchema,
    events: {
      FAILED: FailedEvent,
      RETRY: RetryEvent,
      STAGED: StagedEvent,
      START: StartEvent,
    },
  },
}).createMachine({
  context: { error: null },
  id: "importStart",
  initial: "idle",
  states: {
    // Also where a person lands after closing the staged view: a fresh dialog
    // starts with no memory of the previous attempt.
    idle: {
      on: { START: { target: "starting" } },
    },
    starting: {
      on: {
        STAGED: { target: "staged" },
        FAILED: {
          context: ({ event }) => ({ error: event.message }),
          target: "failed",
        },
      },
    },
    // The job exists and is waiting for a person to review it. The dialog shows
    // the counts and the route to the review page; it never starts another
    // import from here, because one workspace holds one active job.
    staged: {},
    failed: {
      on: {
        RETRY: { context: { error: null }, target: "idle" },
        START: { target: "starting" },
      },
    },
  },
});

/** The four fields of a running actor's snapshot this module reads. */
export type ImportStartSnapshot = {
  readonly context: { readonly error: string | null };
  readonly matches: (state: string) => boolean;
};

export type ImportStartPhase = "failed" | "idle" | "staged" | "starting";

export const toImportStartPhase = (
  snapshot: ImportStartSnapshot
): ImportStartPhase => {
  if (snapshot.matches("starting")) {
    return "starting";
  }

  if (snapshot.matches("staged")) {
    return "staged";
  }

  if (snapshot.matches("failed")) {
    return "failed";
  }

  return "idle";
};

import * as Schema from "effect/Schema";
import { setup } from "xstate";

/**
 * The welcome tour's lifecycle, as an XState machine.
 *
 * The same shape the slug check uses, for the same reason: the parts of this
 * that are easy to get wrong are not the rendering, they are the rules about
 * which step you can be on and what closing means from there.
 *
 * - "finished" is not a boolean. A tour that reached the last step and one
 *   that was dismissed after the second are different outcomes, and only one
 *   of them is worth reporting as a completion. `finished` is `null` until one
 *   of them happens, then never goes back to `null` until the tour is opened
 *   again — which resets it, because a second viewing is a second session.
 * - Every step that is *entered* is recorded once, in `viewedStepIds`. The
 *   count is what tells you how far into the tour someone got, and computing
 *   it from a set rather than from `stepIndex` means going back and forth does
 *   not inflate it. That is the number a "steps viewed" event reports.
 * - `GO_TO` exists because the progress dots are buttons. Clicking one is the
 *   same kind of move as `NEXT` — it enters a step — rather than a jump that
 *   skips recording.
 *
 * XState 6 removed `assign` and the `guard` key on transitions, so a
 * transition below is a target string, a `{ target, context }` patch, or a
 * function returning one of those (or `undefined` for "not this time").
 */

/** How the tour ended. */
export type WelcomeTourFinish = "completed" | "skipped";

type WelcomeTourContext = {
  /** The steps this tour has, as ids. The copy lives in the caller. */
  readonly stepIds: readonly string[];
  readonly stepIndex: number;
  readonly viewedStepIds: readonly string[];
  readonly finished: WelcomeTourFinish | null;
};

type WelcomeTourInput = {
  readonly stepIds: readonly string[];
};

type GoToEvent = {
  readonly index: number;
  readonly type: "GO_TO";
};

const contextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    stepIds: Schema.Array(Schema.String),
    stepIndex: Schema.Finite,
    viewedStepIds: Schema.Array(Schema.String),
    finished: Schema.NullOr(Schema.Literals(["completed", "skipped"])),
  })
);

const inputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ stepIds: Schema.Array(Schema.String) })
);

const eventSchema = (type: string) =>
  Schema.toStandardSchemaV1(Schema.Struct({ type: Schema.Literal(type) }));

const goToSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ index: Schema.Finite, type: Schema.Literal("GO_TO") })
);

/**
 * The step ids at one index, as a list to append.
 *
 * Indexed access, not `ids[index]!`: the machine never trusts the caller's
 * array to be long enough, and an out-of-range index contributing nothing is
 * the correct answer rather than a crash.
 */
const stepAt = (ids: readonly string[], index: number): readonly string[] => {
  const id = ids[index];

  return id === undefined ? [] : [id];
};

const clampIndex = (index: number, length: number): number =>
  Math.min(Math.max(index, 0), Math.max(length - 1, 0));

/**
 * Entering a step is the one thing three different events share, so the patch
 * that records it lives in one place: the index moves and the id is added to
 * the viewed set if it is not there already.
 */
const enterStep = (
  context: WelcomeTourContext,
  index: number
): Partial<WelcomeTourContext> => {
  const stepId = context.stepIds[index];

  const alreadyViewed =
    stepId === undefined || context.viewedStepIds.includes(stepId);

  return {
    stepIndex: index,
    viewedStepIds: alreadyViewed
      ? context.viewedStepIds
      : [...context.viewedStepIds, stepId],
  };
};

/**
 * The tour, declared once and fed its steps as actor input.
 *
 * Steps are input rather than a module constant because they are content, and
 * content changes with the product's surfaces; the machine's job is the rules
 * between them, which do not.
 */
export const welcomeTourMachine = setup({
  schemas: {
    context: contextSchema,
    events: {
      BACK: eventSchema("BACK"),
      CLOSE: eventSchema("CLOSE"),
      GO_TO: goToSchema,
      NEXT: eventSchema("NEXT"),
      OPEN: eventSchema("OPEN"),
    },
    input: inputSchema,
  },
}).createMachine({
  context: ({ input }: { input: WelcomeTourInput }) => ({
    stepIds: input.stepIds,
    stepIndex: 0,
    viewedStepIds: [],
    finished: null,
  }),
  id: "welcomeTour",
  initial: "closed",
  states: {
    closed: {
      on: {
        // Opening resets the session: index to the first step, the viewed set
        // to just that step, and `finished` back to `null`. A reopened tour
        // has not finished yet, whatever happened last time.
        OPEN: ({ context }: { context: WelcomeTourContext }) =>
          context.stepIds.length === 0
            ? undefined
            : {
                context: {
                  finished: null,
                  stepIndex: 0,
                  viewedStepIds: stepAt(context.stepIds, 0),
                },
                target: "open",
              },
      },
    },
    open: {
      on: {
        // Next on the last step is the completion, not a move: there is no
        // step after it, so the only thing a "Continue" can mean is "done".
        NEXT: ({ context }: { context: WelcomeTourContext }) => {
          const nextIndex = context.stepIndex + 1;

          return nextIndex >= context.stepIds.length
            ? { context: { finished: "completed" }, target: "closed" }
            : { context: enterStep(context, nextIndex) };
        },
        // Back on the first step is a no-op rather than a close: the dialog's
        // footer swaps Back for Skip there, and a stray Left arrow should not
        // dismiss a tour the reader is reading.
        BACK: ({ context }: { context: WelcomeTourContext }) =>
          context.stepIndex === 0
            ? undefined
            : { context: enterStep(context, context.stepIndex - 1) },
        GO_TO: ({
          context,
          event,
        }: {
          context: WelcomeTourContext;
          event: GoToEvent;
        }) => ({
          context: enterStep(
            context,
            clampIndex(event.index, context.stepIds.length)
          ),
        }),
        // Closing is the skip. It is also what a backdrop click and Escape
        // send, so a tour dismissed without reading it is recorded as such
        // instead of being reported as a fourth completion.
        CLOSE: () => ({ context: { finished: "skipped" }, target: "closed" }),
      },
    },
  },
});

/**
 * The fields of a running actor's snapshot this module reads.
 *
 * Structural rather than `SnapshotFrom<…>` because `@xstate/react` widens the
 * snapshot's `status` for its own subscribers, and this module only asks which
 * state the machine is in.
 */
export type WelcomeTourSnapshot = {
  readonly context: WelcomeTourContext;
  readonly matches: (state: string) => boolean;
};

/** What the dialog renders. */
export type WelcomeTourView = {
  readonly canGoBack: boolean;
  readonly finished: WelcomeTourFinish | null;
  readonly isLastStep: boolean;
  readonly open: boolean;
  readonly stepId: string | null;
  readonly stepIndex: number;
  readonly viewedCount: number;
};

/** Collapses a snapshot into the shape the dialog renders. */
export const toWelcomeTourView = (
  snapshot: WelcomeTourSnapshot
): WelcomeTourView => {
  const { context } = snapshot;
  const open = snapshot.matches("open");

  return {
    canGoBack: context.stepIndex > 0,
    finished: context.finished,
    isLastStep: context.stepIndex >= context.stepIds.length - 1,
    open,
    // A closed tour is on no step, whatever index it stopped at: the dialog
    // is gone, and reporting a step would describe a dialog nobody can see.
    stepId: open ? (context.stepIds[context.stepIndex] ?? null) : null,
    stepIndex: context.stepIndex,
    viewedCount: context.viewedStepIds.length,
  };
};

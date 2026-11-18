import * as Schema from "effect/Schema";
import { createAsyncLogic, setup } from "xstate";

import {
  type RegisterDraft,
  registerStepIds,
  type RegisterStepId,
  selectedBoardNames,
  selectedInvites,
} from "./register-draft";

/**
 * The register wizard's lifecycle, as an XState machine.
 *
 * The steps are in the context, not in the state chart: walking forward and
 * back through four answers is one state (`editing`) with an index, and giving
 * each step its own state would multiply every event by four. What does earn a
 * state is everything the reader did not ask for and cannot see coming:
 *
 * - `submitting`: the workspace is being created and the button must not be
 *   pressed twice.
 * - `finishing`: the workspace exists, and the logo and the invitations are
 *   still being applied. This is deliberately a separate state from `done`
 *   because the two have opposite failure rules. A failed create leaves
 *   nothing behind and must go back to the form. A failed logo or invitation
 *   leaves a real workspace behind, so it is a warning, not an error.
 * - `done`: terminal. The page navigates from here.
 * - `failed`: the create refused. The reader keeps every answer, and `EDIT`
 *   returns them to the form rather than making them start over.
 *
 * Whether the current step is answered is not the machine's to store. The form
 * owns the answers, so the page derives that during render and sends it with
 * the event it belongs to (`NEXT`). A copy in the machine made a second owner,
 * needed an effect to keep the two in step, and could not describe a step that
 * arrived already answered: nothing about it ever changed, so nothing reported
 * it, and Continue stayed disabled on a step the reader could plainly leave.
 */

export type RegisterWizardStepId = RegisterStepId;

/** What the workspace ended up with, once the smoke clears. */
export type RegisterOutcome = {
  readonly failedInvites: readonly string[];
  readonly invited: readonly string[];
  readonly isFirstWorkspace: boolean;
  readonly logoUploaded: boolean;
  readonly organizationId: string;
};

/** The RPC payload a create needs. */
export type CreateWorkspacePayload = {
  readonly boardNames: readonly string[];
  readonly subdomain: string;
  readonly workspaceName: string;
};

/** The work that happens once the workspace exists. */
export type FinishWorkspacePayload = {
  readonly invites: readonly string[];
  readonly logo: File | null;
  readonly organizationId: string;
};

export type FinishWorkspaceResult = {
  readonly failedInvites: readonly string[];
  readonly invited: readonly string[];
  readonly logoUploaded: boolean;
};

export type RegisterWizardContext = {
  readonly draft: RegisterDraft | null;
  readonly error: string | null;
  readonly outcome: RegisterOutcome | null;
  readonly stepIds: readonly RegisterWizardStepId[];
  readonly stepIndex: number;
};

type NextEvent = {
  readonly canContinue: boolean;
  readonly type: "NEXT";
};

type SubmitEvent = {
  readonly draft: RegisterDraft;
  readonly type: "SUBMIT";
};

type GoToEvent = {
  readonly index: number;
  readonly type: "GO_TO";
};

const contextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    draft: Schema.NullOr(
      Schema.Struct({
        boards: Schema.Array(
          Schema.Struct({
            enabled: Schema.Boolean,
            id: Schema.String,
            name: Schema.String,
          })
        ),
        invites: Schema.Array(Schema.String),
        logo: Schema.NullOr(Schema.Any),
        subdomain: Schema.String,
        workspaceName: Schema.String,
      })
    ),
    error: Schema.NullOr(Schema.String),
    outcome: Schema.NullOr(
      Schema.Struct({
        failedInvites: Schema.Array(Schema.String),
        invited: Schema.Array(Schema.String),
        isFirstWorkspace: Schema.Boolean,
        logoUploaded: Schema.Boolean,
        organizationId: Schema.String,
      })
    ),
    stepIds: Schema.Array(Schema.Literals(registerStepIds)),
    stepIndex: Schema.Finite,
  })
);

const inputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ stepIds: Schema.Array(Schema.Literals(registerStepIds)) })
);

const eventSchema = (type: string) =>
  Schema.toStandardSchemaV1(Schema.Struct({ type: Schema.Literal(type) }));

const nextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ canContinue: Schema.Boolean, type: Schema.Literal("NEXT") })
);

const goToSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ index: Schema.Finite, type: Schema.Literal("GO_TO") })
);

const submitSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    draft: Schema.Struct({
      boards: Schema.Array(
        Schema.Struct({
          enabled: Schema.Boolean,
          id: Schema.String,
          name: Schema.String,
        })
      ),
      invites: Schema.Array(Schema.String),
      logo: Schema.NullOr(Schema.Any),
      subdomain: Schema.String,
      workspaceName: Schema.String,
    }),
    type: Schema.Literal("SUBMIT"),
  })
);

/**
 * What a create call settles with.
 *
 * A refusal is a value, not a throw: the RPC layer is the only place that knows
 * what a transport failure means, and it is also the only place that can turn
 * one into a sentence. Everything above it, including this machine, gets one of
 * two shapes and never an `unknown` to guess at.
 */
export type CreateWorkspaceResult =
  | {
      readonly isFirstWorkspace: boolean;
      readonly ok: true;
      readonly organizationId: string;
    }
  | { readonly message: string; readonly ok: false };

/** The create call, injected so a test drives the machine without a server. */
export type CreateWorkspace = (
  payload: CreateWorkspacePayload
) => Promise<CreateWorkspaceResult>;

/** The post-create work, injected for the same reason. */
export type FinishWorkspace = (
  payload: FinishWorkspacePayload
) => Promise<FinishWorkspaceResult>;

const isLastStep = (context: RegisterWizardContext): boolean =>
  context.stepIndex >= context.stepIds.length - 1;

/** Whether anything has to happen after the workspace exists. */
const needsFinishing = (draft: RegisterDraft | null): boolean =>
  draft !== null && (draft.logo !== null || selectedInvites(draft).length > 0);

/**
 * Builds the wizard around the two calls it makes.
 *
 * Everything below the calls is the real interpreter, so a test exercises the
 * same transitions the page does.
 */
export const createRegisterWizardMachine = ({
  createWorkspace,
  finishWorkspace,
}: {
  readonly createWorkspace: CreateWorkspace;
  readonly finishWorkspace: FinishWorkspace;
}) =>
  setup({
    actors: {
      createWorkspace: createAsyncLogic<
        CreateWorkspaceResult,
        CreateWorkspacePayload
      >({
        id: "createWorkspace",
        run: ({ input }) => createWorkspace(input),
      }),
      finishWorkspace: createAsyncLogic<
        FinishWorkspaceResult,
        FinishWorkspacePayload
      >({
        id: "finishWorkspace",
        run: ({ input }) => finishWorkspace(input),
      }),
    },
    schemas: {
      context: contextSchema,
      events: {
        BACK: eventSchema("BACK"),
        EDIT: eventSchema("EDIT"),
        GO_TO: goToSchema,
        NEXT: nextSchema,
        SUBMIT: submitSchema,
      },
      input: inputSchema,
    },
  }).createMachine({
    context: ({
      input,
    }: {
      input: { stepIds: readonly RegisterWizardStepId[] };
    }) => ({
      draft: null,
      error: null,
      outcome: null,
      stepIds: input.stepIds,
      stepIndex: 0,
    }),
    id: "registerWizard",
    initial: "editing",
    states: {
      editing: {
        on: {
          // The answer arrives with the move. A step that cannot be left does
          // not transition, and the same value decides the button's disabled
          // state, so the two cannot disagree.
          NEXT: ({
            context,
            event,
          }: {
            context: RegisterWizardContext;
            event: NextEvent;
          }) => {
            if (!event.canContinue) {
              return undefined;
            }

            return isLastStep(context)
              ? { target: "submitting" }
              : { context: { stepIndex: context.stepIndex + 1 } };
          },
          BACK: ({ context }: { context: RegisterWizardContext }) =>
            context.stepIndex === 0
              ? undefined
              : { context: { stepIndex: context.stepIndex - 1 } },
          GO_TO: ({
            context,
            event,
          }: {
            context: RegisterWizardContext;
            event: GoToEvent;
          }) => {
            const index = Math.min(
              Math.max(event.index, 0),
              Math.max(context.stepIds.length - 1, 0)
            );

            return index === context.stepIndex
              ? undefined
              : { context: { stepIndex: index } };
          },
          SUBMIT: ({ event }: { event: SubmitEvent }) => ({
            context: { draft: event.draft, error: null },
            target: "submitting",
          }),
        },
      },
      submitting: {
        invoke: {
          src: "createWorkspace",
          input: ({ context }: { context: RegisterWizardContext }) => {
            const draft = context.draft;

            if (draft === null) {
              throw new Error("The wizard reached submit with no draft");
            }

            return {
              boardNames: selectedBoardNames(draft),
              subdomain: draft.subdomain.trim().toLowerCase(),
              workspaceName: draft.workspaceName.trim(),
            };
          },
          onDone: ({
            context,
            event,
          }: {
            context: RegisterWizardContext;
            event: { output: CreateWorkspaceResult };
          }) => {
            if (!event.output.ok) {
              return {
                context: { error: event.output.message },
                target: "failed",
              };
            }

            return {
              context: {
                outcome: {
                  failedInvites: [],
                  invited: [],
                  isFirstWorkspace: event.output.isFirstWorkspace,
                  logoUploaded: false,
                  organizationId: event.output.organizationId,
                },
              },
              target: needsFinishing(context.draft) ? "finishing" : "done",
            };
          },
          // The two shapes above are the failures this state knows how to
          // describe. Anything that reaches here is a bug in the create call
          // itself, and the reader still gets a sentence rather than a blank
          // screen.
          onError: {
            context: { error: "Could not create the workspace. Try again." },
            target: "failed",
          },
        },
      },
      finishing: {
        invoke: {
          src: "finishWorkspace",
          input: ({ context }: { context: RegisterWizardContext }) => {
            const draft = context.draft;
            const outcome = context.outcome;

            if (draft === null || outcome === null) {
              throw new Error("The wizard reached finish with no workspace");
            }

            return {
              invites: selectedInvites(draft),
              logo: draft.logo,
              organizationId: outcome.organizationId,
            };
          },
          onDone: ({
            context,
            event,
          }: {
            context: RegisterWizardContext;
            event: { output: FinishWorkspaceResult };
          }) => ({
            context: {
              outcome:
                context.outcome === null
                  ? null
                  : {
                      ...context.outcome,
                      failedInvites: event.output.failedInvites,
                      invited: event.output.invited,
                      logoUploaded: event.output.logoUploaded,
                    },
            },
            target: "done",
          }),
          // The workspace exists either way. A logo or an invitation that could
          // not be applied is something the reader can do from settings, so it
          // must not turn a created workspace into an error screen.
          onError: { target: "done" },
        },
      },
      done: { type: "final" },
      failed: {
        on: {
          EDIT: { target: "editing" },
          SUBMIT: ({ event }: { event: SubmitEvent }) => ({
            context: { draft: event.draft, error: null },
            target: "submitting",
          }),
        },
      },
    },
  });

/** What the page renders. */
export type RegisterWizardView = {
  readonly error: string | null;
  readonly isBusy: boolean;
  readonly isDone: boolean;
  readonly isFailed: boolean;
  readonly isLastStep: boolean;
  readonly outcome: RegisterOutcome | null;
  readonly stepId: RegisterWizardStepId | null;
  readonly stepIndex: number;
};

export type RegisterWizardSnapshot = {
  readonly context: RegisterWizardContext;
  readonly matches: (state: string) => boolean;
};

/** Collapses a snapshot into the shape the page renders. */
export const toRegisterWizardView = (
  snapshot: RegisterWizardSnapshot
): RegisterWizardView => {
  const { context } = snapshot;
  const busy = snapshot.matches("submitting") || snapshot.matches("finishing");

  return {
    error: context.error,
    isBusy: busy,
    isDone: snapshot.matches("done"),
    isFailed: snapshot.matches("failed"),
    isLastStep: isLastStep(context),
    outcome: context.outcome,
    stepId:
      busy || snapshot.matches("done")
        ? null
        : (context.stepIds[context.stepIndex] ?? null),
    stepIndex: context.stepIndex,
  };
};

import * as Schema from "effect/Schema";
import { createAsyncLogic, setup } from "xstate";

import { fetchRpc } from "~/lib/runtime";

/**
 * The lifecycle of one workspace-slug availability check, as an XState machine.
 *
 * The hook this replaces held the lifecycle in four signals and one effect: a
 * debounce timer, an `AbortController`, a `cancelled` flag, and `setState`
 * calls that each had to remember which of the others it invalidated. The
 * states were real — `idle` means "there is nothing to ask", `checking` means
 * "an answer is in flight and a superseded one must not land" — but nothing
 * said so, and nothing stopped a stale result from being displayed for the
 * 350 ms the timer was re-arming.
 *
 * Declaring them buys three things the effect had to arrange by hand:
 *
 * - Leaving `checking` stops the invoked actor, which aborts the request
 *   through the `AbortSignal` XState hands the async logic. A superseded
 *   response can no longer arrive, so the `cancelled` flag is gone.
 * - The debounce is `debouncing`'s `after`. Re-entering that state restarts
 *   the timer, which is what "the input settled" means; the effect had to
 *   clear and re-arm a `setTimeout` to get the same thing.
 * - `INPUT` is handled at the root, so every state reacts to a changed slug the
 *   same way. The effect re-ran because React compared a dependency array;
 *   here it is a transition.
 *
 * XState 6 removed both `assign` and the `guard` key on transition objects:
 * a transition is a target string, a `{ target, context }` patch, or a function
 * returning one of those (or `undefined` for "not this time"). That is why the
 * branches below are functions rather than guard arrays — the condition sits
 * next to the target it selects.
 *
 * The machine runs on XState's own interpreter through `@xstate/react`'s
 * `useMachine`, not on `@xstate/effect`'s `createEffectActor`: its only work is
 * one `fetchRpc` call, there is no Effect service for an actor to capture, and
 * a React component needs a plain actor to subscribe to.
 */

/** What a caller renders; unchanged from the hook's previous return shape. */
export type SlugAvailability = {
  readonly status: "idle" | "checking" | "available" | "taken" | "error";
  readonly suggestion: string | null;
  readonly reason: string | null;
};

type SlugCheckInput = {
  readonly slug: string;
};

type SlugCheckResult = {
  readonly available: boolean;
  readonly reason: string | null;
  readonly suggestion: string | null;
};

type SlugAvailabilityContext = {
  readonly enabled: boolean;
  readonly reason: string | null;
  readonly slug: string;
  readonly suggestion: string | null;
};

type SlugInputEvent = {
  readonly type: "INPUT";
  readonly enabled: boolean;
  readonly slug: string;
};

type SlugCheckSettledEvent = {
  readonly output: SlugCheckResult;
};

type SlugAvailabilityInput = {
  readonly enabled: boolean;
  readonly slug: string;
};

/** How long the slug field must sit still before a check is worth a request. */
const SLUG_CHECK_DEBOUNCE_MS = 350;

/**
 * XState only validates at runtime when a `validator` is configured, so these
 * schemas exist for their types: without one, `context` and `event` would be
 * `Record<string, any>` and every read in a transition would go unchecked.
 */
const AvailabilityContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    enabled: Schema.Boolean,
    reason: Schema.NullOr(Schema.String),
    slug: Schema.String,
    suggestion: Schema.NullOr(Schema.String),
  })
);

const InputEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    enabled: Schema.Boolean,
    slug: Schema.String,
    type: Schema.Literal("INPUT"),
  })
);

/**
 * The value the field already holds when the machine starts — a prefilled name
 * when the user steps back to this form. It is actor `input` rather than a
 * `send()` on mount because `useMachine` seeds the actor once: rendering is not
 * an event, and an effect whose whole job is to hand React's current value to
 * an actor is the pattern this removes.
 */
const SlugInputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ enabled: Schema.Boolean, slug: Schema.String })
);

/** True when there is something to ask about. */
const hasQuery = ({ enabled, slug }: SlugAvailabilityContext): boolean =>
  enabled && slug.length > 0;

/**
 * The one request this lifecycle makes, as a plain function so a test can
 * supply its own: the machine takes the checker as a constructor argument
 * rather than reaching into a module.
 *
 * It runs as an `invoke` child, so the actor's lifetime is the request's: the
 * signal aborts when `checking` is left, which ends the *caller's* wait — the
 * response can no longer arrive, so it can never be rendered. It does not undo
 * a request the client already posted: `CheckWorkspaceSlug` is batched, and a
 * batch that has been sent may still be processed server-side. Cancellation
 * here is about what the field may show, not about sparing the server work.
 */
export type SlugAvailabilityCheck = (
  input: SlugCheckInput,
  signal: AbortSignal
) => Promise<SlugCheckResult>;

const checkWorkspaceSlug: SlugAvailabilityCheck = ({ slug }, signal) =>
  fetchRpc((rpc) => rpc.CheckWorkspaceSlug({ slug }), { signal });

/** The context patch a settled check applies, whether or not the slug is free. */
const settledContext = ({
  available,
  reason,
  suggestion,
}: SlugCheckResult): Partial<SlugAvailabilityContext> => ({
  reason: available ? null : reason,
  suggestion: available ? null : suggestion,
});

/** The context patch a changed input applies before anything else happens. */
const inputContext = ({
  enabled,
  slug,
}: SlugInputEvent): Partial<SlugAvailabilityContext> => ({
  enabled,
  reason: null,
  slug,
  suggestion: null,
});

/**
 * Builds the machine around one checker. The factory exists so a test can
 * supply its own request instead of mocking a module: everything below the
 * checker — the debounce, the abort, both outcomes — is the real interpreter.
 */
export const createSlugAvailabilityMachine = (check: SlugAvailabilityCheck) =>
  setup({
    actors: {
      checkSlugAvailability: createAsyncLogic<SlugCheckResult, SlugCheckInput>({
        id: "checkWorkspaceSlug",
        run: ({ input, signal }) => check(input, signal),
      }),
    },
    schemas: {
      context: AvailabilityContextSchema,
      events: { INPUT: InputEventSchema },
      input: SlugInputSchema,
    },
  }).createMachine({
    context: ({ input }: { input: SlugAvailabilityInput }) => ({
      enabled: input.enabled,
      reason: null,
      slug: input.slug,
      suggestion: null,
    }),
    id: "workspaceSlugAvailability",
    initial: "idle",
    // At the root so a slug change is handled identically in every state: arm
    // the debounce, or drop to `idle` and abort whatever was in flight.
    on: {
      INPUT: ({
        context,
        event,
      }: {
        context: SlugAvailabilityContext;
        event: SlugInputEvent;
      }) => {
        // The field is reported on every keystroke, but only the normalized
        // slug matters. Capitalizing a name it has already checked would
        // otherwise throw away a settled answer and ask again for the same
        // string.
        if (event.enabled === context.enabled && event.slug === context.slug) {
          return undefined;
        }
        return {
          context: inputContext(event),
          target:
            event.enabled && event.slug.length > 0 ? ".debouncing" : ".idle",
        };
      },
    },
    states: {
      idle: {
        // A machine that starts holding a name already typed owes the field a
        // check, so mounting mid-form behaves exactly like typing does.
        always: ({ context }: { context: SlugAvailabilityContext }) =>
          hasQuery(context) ? { target: "debouncing" } : undefined,
      },
      // Re-entering restarts the timer, so this state's own duration is the
      // debounce, and `checking` is the only way out of it.
      debouncing: {
        after: {
          [SLUG_CHECK_DEBOUNCE_MS]: { target: "checking" },
        },
      },
      checking: {
        invoke: {
          src: "checkSlugAvailability",
          input: ({ context }: { context: SlugAvailabilityContext }) => ({
            slug: context.slug,
          }),
          // One transition, two outcomes: the answer is applied to the context
          // either way, and only the target differs.
          onDone: ({ event }: { event: SlugCheckSettledEvent }) => ({
            context: settledContext(event.output),
            target: event.output.available ? "available" : "taken",
          }),
          onError: { target: "error" },
        },
      },
      available: {},
      taken: {},
      error: {},
    },
  });

/** The machine the app runs, wired to the real RPC. */
export const slugAvailabilityMachine =
  createSlugAvailabilityMachine(checkWorkspaceSlug);

/**
 * The two fields of a running actor's snapshot this module reads. Structural
 * rather than `SnapshotFrom<…>` because `@xstate/react` widens the snapshot's
 * `status` for its own subscribe helpers, and this module only ever asks which
 * state the machine is in.
 */
export type SlugAvailabilitySnapshot = {
  readonly context: SlugAvailabilityContext;
  readonly matches: (state: string) => boolean;
};

/**
 * Collapses a snapshot into the shape the field renders.
 *
 * `debouncing` reports `idle`, not the previous answer: once the slug has
 * changed, the last result describes a name the user is no longer typing, and
 * showing it for 350 ms is the stale flash this machine exists to remove. The
 * old hook did exactly that, because its state only moved when the timer fired.
 */
export const toSlugAvailability = (
  snapshot: SlugAvailabilitySnapshot
): SlugAvailability => {
  if (snapshot.matches("taken")) {
    return {
      status: "taken",
      suggestion: snapshot.context.suggestion,
      reason: snapshot.context.reason,
    };
  }
  if (snapshot.matches("checking")) {
    return { status: "checking", suggestion: null, reason: null };
  }
  if (snapshot.matches("available")) {
    return { status: "available", suggestion: null, reason: null };
  }
  if (snapshot.matches("error")) {
    return { status: "error", suggestion: null, reason: null };
  }
  // `idle` and `debouncing`: nothing has settled, so nothing is claimed.
  return { status: "idle", suggestion: null, reason: null };
};

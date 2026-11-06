import * as Schema from "effect/Schema";
import { createAsyncLogic, setup } from "xstate";

import { dashboardCollections } from "~/lib/collections";
import { fetchRpc } from "~/lib/runtime";

import { isPaidPlan, type PlanType } from "./plans";

/**
 * The lifecycle of the "did the checkout stick?" confirmation, as an XState
 * machine.
 *
 * The page used to hold this in one `useState` and a `setInterval`: a status of
 * `pending | delayed | error`, an immediate `ConfirmBillingCheckout` call, and
 * ten 3-second refetches before giving up. That encoded a real state graph —
 * a confirmation request, a bounded poll, and the ways the poll can settle —
 * but nothing said so, and the interval kept firing after an error even though
 * the UI already offered a retry.
 *
 * Declaring it buys the same three things the slug machine gets:
 *
 * - Reaching `confirmed` leaves `active` and stops both invoked actors, so a
 *   plan read that the machine already superseded cannot land. A failed or
 *   timed-out read stays inside `active`: the confirmation RPC keeps running,
 *   because that is the call that persists the subscription.
 * - The poll interval is `waiting`'s `after`, the read deadline is the
 *   invoke's `timeout`, and the attempt bound is the edge out of
 *   `refetching`; there is no separate counter to clear.
 * - `RETRY` is one transition back to `active`, which both re-confirms with
 *   Polar and restarts the poll. The button and the automatic flow cannot
 *   drift apart.
 *
 * The machine runs on XState's own interpreter through `@xstate/react`'s
 * `useMachine`, not on `@xstate/effect`: its work is two browser calls, and a
 * React component needs a plain actor to subscribe to.
 */

/** What the alert renders. `hidden` means there is no checkout to confirm. */
export type CheckoutConfirmationStatus =
  | "hidden"
  | "pending"
  | "confirmed"
  | "delayed"
  | "error";

type CheckoutConfirmationRequest = {
  /** Null only in an unreachable retry path; the actor treats it as a no-op. */
  readonly checkoutId: string | null;
  readonly organizationId: string;
};

type CheckoutConfirmationInput = {
  readonly checkoutId: string | null;
  readonly organizationId: string;
  readonly plan?: PlanType | undefined;
};

type CheckoutConfirmationContext = CheckoutConfirmationInput & {
  readonly attempts: number;
};

type PlanCheckResult = {
  readonly plan: PlanType | undefined;
};

type PlanCheckSettledEvent = {
  readonly output: PlanCheckResult;
};

/** How long the success page waits between workspace-plan reads. */
const CHECKOUT_POLL_INTERVAL_MS = 3000;

/** How many reads before the page tells the buyer it is taking longer. */
const CHECKOUT_POLL_ATTEMPTS = 10;

/**
 * How long one read may take before it counts as an empty read. A stalled
 * `refetch` has no deadline of its own, and without this the machine would sit
 * on `pending` forever instead of reaching the delayed state the page shows.
 */
const CHECKOUT_READ_TIMEOUT_MS = 10_000;

/**
 * The two browser calls this lifecycle makes, injected so a test can drive the
 * real interpreter without a module mock.
 */
type CheckoutConfirmationDependencies = {
  readonly confirmCheckout: (
    input: CheckoutConfirmationRequest,
    signal: AbortSignal
  ) => Promise<void>;
  readonly readPlan: (organizationId: string) => PlanType | undefined;
  readonly refetchPlan: () => Promise<void>;
};

/**
 * The transition an empty or timed-out plan read takes. Both are "no plan
 * yet": count the attempt, wait, and stop at the bound rather than reporting
 * an error the buyer cannot act on. A read that actually rejects still goes to
 * `#checkoutError`.
 */
const emptyPlanRead = (context: CheckoutConfirmationContext) => {
  const attempts = context.attempts + 1;
  const target =
    attempts >= CHECKOUT_POLL_ATTEMPTS ? "#checkoutDelayed" : "waiting";
  return { context: { attempts }, target };
};

/**
 * XState only validates at runtime when a `validator` is configured, so these
 * schemas exist for their types: without one, `context` and `event` would be
 * `Record<string, any>` and every read in a transition would go unchecked.
 */
const PlanSchema = Schema.Literals(["free", "starter", "professional"]);

const ConfirmationContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    attempts: Schema.Finite,
    checkoutId: Schema.NullOr(Schema.String),
    organizationId: Schema.String,
    plan: Schema.optional(PlanSchema),
  })
);

const ConfirmationInputSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    checkoutId: Schema.NullOr(Schema.String),
    organizationId: Schema.String,
    plan: Schema.optional(PlanSchema),
  })
);

const RetryEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("RETRY") })
);

/**
 * Builds the machine around one set of calls. The factory exists so a test can
 * supply its own reader and RPC instead of mocking modules: the poll interval,
 * the attempt bound and both early exits are the real interpreter.
 */
export const createCheckoutConfirmationMachine = ({
  confirmCheckout,
  readPlan,
  refetchPlan,
}: CheckoutConfirmationDependencies) =>
  setup({
    actors: {
      confirmCheckout: createAsyncLogic<void, CheckoutConfirmationRequest>({
        id: "confirmBillingCheckout",
        run: async ({ input, signal }) => {
          try {
            await confirmCheckout(input, signal);
          } catch {
            // The webhook remains the durable sync, so a failed confirmation
            // only costs the fast path; the poll below recovers when it lands.
          }
        },
      }),
      readWorkspacePlan: createAsyncLogic<
        PlanCheckResult,
        { organizationId: string }
      >({
        id: "readWorkspacePlan",
        run: async ({ input, signal }) => {
          await refetchPlan();
          // The actor is stopped when `active` is left; reporting the read it
          // already started would just be ignored, but the signal keeps the
          // intent explicit.
          return {
            plan: signal.aborted ? undefined : readPlan(input.organizationId),
          };
        },
      }),
    },
    schemas: {
      context: ConfirmationContextSchema,
      events: { RETRY: RetryEventSchema },
      input: ConfirmationInputSchema,
    },
  }).createMachine({
    context: ({ input }: { input: CheckoutConfirmationInput }) => ({
      attempts: 0,
      checkoutId: input.checkoutId,
      organizationId: input.organizationId,
      plan: input.plan,
    }),
    id: "billingCheckoutConfirmation",
    initial: "idle",
    states: {
      // No checkout id, or a plan the page already sees as paid, owes no
      // confirmation. Choosing the state here rather than in the component
      // keeps the "already paid" case from firing a pointless RPC on reload.
      idle: {
        always: ({ context }: { context: CheckoutConfirmationContext }) =>
          context.checkoutId === null
            ? undefined
            : isPaidPlan(context.plan)
              ? { target: "confirmed" }
              : { target: "active" },
      },
      active: {
        id: "active",
        type: "parallel",
        states: {
          // Polar is asked once, in parallel with the poll. Its failure is
          // swallowed inside the actor because a webhook may still arrive.
          confirmation: {
            initial: "sending",
            states: {
              sending: {
                invoke: {
                  src: "confirmCheckout",
                  input: ({
                    context,
                  }: {
                    context: CheckoutConfirmationContext;
                  }) => ({
                    checkoutId: context.checkoutId,
                    organizationId: context.organizationId,
                  }),
                },
              },
            },
          },
          // The first read runs on entry; each empty one waits a poll interval
          // and tries again, until the plan is paid or the attempt bound is
          // reached. A failed read is a real error the page can retry, not a
          // silent empty poll.
          polling: {
            initial: "refetching",
            states: {
              refetching: {
                invoke: {
                  src: "readWorkspacePlan",
                  input: ({
                    context,
                  }: {
                    context: CheckoutConfirmationContext;
                  }) => ({
                    organizationId: context.organizationId,
                  }),
                  timeout: CHECKOUT_READ_TIMEOUT_MS,
                  onDone: ({
                    context,
                    event,
                  }: {
                    context: CheckoutConfirmationContext;
                    event: PlanCheckSettledEvent;
                  }) =>
                    isPaidPlan(event.output.plan)
                      ? {
                          context: { plan: event.output.plan },
                          target: "#confirmed",
                        }
                      : emptyPlanRead(context),
                  // A stalled read is a poll attempt that produced no answer,
                  // not a page-level error: count it and try again.
                  onTimeout: ({
                    context,
                  }: {
                    context: CheckoutConfirmationContext;
                  }) => emptyPlanRead(context),
                  onError: { target: "#checkoutError" },
                },
              },
              waiting: {
                after: {
                  [CHECKOUT_POLL_INTERVAL_MS]: { target: "refetching" },
                },
              },
              // Both terminal poll outcomes stay inside `active`, so the
              // confirmation RPC is never aborted just because a read failed.
              // `RETRY` re-enters `active`, which re-runs both regions.
              delayed: {
                id: "checkoutDelayed",
                on: {
                  RETRY: { context: { attempts: 0 }, target: "#active" },
                },
              },
              error: {
                id: "checkoutError",
                on: {
                  RETRY: { context: { attempts: 0 }, target: "#active" },
                },
              },
            },
          },
        },
      },
      confirmed: { id: "confirmed" },
    },
  });

/**
 * Confirms with Polar, then reads the workspace plan from the collection the
 * page's live query already owns — the same row the plan cards render.
 */
const confirmCheckout: CheckoutConfirmationDependencies["confirmCheckout"] =
  async ({ checkoutId, organizationId }, signal) => {
    if (checkoutId === null) {
      return;
    }
    await fetchRpc(
      (rpc) => rpc.ConfirmBillingCheckout({ organizationId, checkoutId }),
      { signal }
    );
  };

const refetchPlan: CheckoutConfirmationDependencies["refetchPlan"] =
  async () => {
    await dashboardCollections.workspacePlanCollection.utils.refetch({
      throwOnError: true,
    });
  };

const readPlan: CheckoutConfirmationDependencies["readPlan"] = (
  organizationId
) => dashboardCollections.workspacePlanCollection.get(organizationId)?.plan;

/** The machine the page runs, wired to the real RPC and plan collection. */
export const checkoutConfirmationMachine = createCheckoutConfirmationMachine({
  confirmCheckout,
  readPlan,
  refetchPlan,
});

/**
 * The fields of an actor's snapshot this module reads. Structural rather than
 * `SnapshotFrom<…>` for the same reason as the slug machine: `@xstate/react`
 * widens the snapshot's `status`, and this module only asks which state the
 * machine is in and what it was seeded with.
 */
export type CheckoutConfirmationSnapshot = {
  readonly context: {
    readonly checkoutId: string | null;
    readonly plan?: PlanType | undefined;
  };
  readonly matches: (state: string) => boolean;
};

/** Collapses a snapshot into the statuses the alert renders. */
export const toCheckoutConfirmationStatus = (
  snapshot: CheckoutConfirmationSnapshot
): CheckoutConfirmationStatus => {
  if (snapshot.matches("confirmed")) return "confirmed";
  if (snapshot.matches("#checkoutDelayed")) return "delayed";
  if (snapshot.matches("#checkoutError")) return "error";
  if (snapshot.matches("active")) return "pending";
  if (snapshot.context.checkoutId === null) return "hidden";
  // `useMachine` starts the actor in an effect, so the first paint still holds
  // `idle`'s snapshot. Answer it from the input the actor was seeded with
  // rather than flashing no alert for a frame on the checkout redirect.
  return isPaidPlan(snapshot.context.plan) ? "confirmed" : "pending";
};

import {
  EMAIL_SUBSCRIPTION_STATES,
  type TEmailSubscriptionState,
} from "@feeblo/domain-contracts/email";
import { setupEffect } from "@xstate/effect";
import * as Schema from "effect/Schema";
import { transition } from "xstate";

/**
 * The lifecycle of one email subscription, as an XState machine.
 *
 * Subscriptions had five stored states and two ways of deciding the next one:
 * a 28-line `if` chain in `email-subscription/repository.ts` that answered "what
 * does a new consent request mean for this row", and five separate `WHERE`
 * clauses for the moves that do not go through it. Nothing tied the two
 * together, and they had already drifted: the token unsubscribe can stop a
 * `deferred_no_access` row, while the authenticated one listed three source
 * states and could not.
 *
 * Two event kinds are modelled here, deliberately:
 *
 * - `request` is a **decision**. It is asked before a row is written (and when
 *   no row exists at all), so it has several possible targets and is answered
 *   by `nextStateForRequest`. Nothing generates SQL from it.
 * - The other four are **transitions**. Each has one target, so the repository
 *   builds its `SET` and `WHERE` from the machine and cannot write a move the
 *   graph does not permit.
 *
 * `none` is a state here even though the column has no such value: "no
 * subscription yet" is what a first request starts from, and making it explicit
 * is what lets `request` be a normal transition instead of a special case.
 */
export const EMAIL_SUBSCRIPTION_EVENTS = [
  "activate",
  "pause",
  "resume",
  "unsubscribe",
  "verify",
] as const;

export type TEmailSubscriptionEvent =
  (typeof EMAIL_SUBSCRIPTION_EVENTS)[number];

/**
 * The states the machine knows about: the stored five, plus the absence of a
 * row, which only a decision can start from.
 */
export type TEmailSubscriptionNode = TEmailSubscriptionState | "none";

type SubscriptionContext = {
  readonly alreadyVerified: boolean;
  readonly deferredNoAccess: boolean;
};

const NODES: readonly TEmailSubscriptionNode[] = [
  "none",
  ...EMAIL_SUBSCRIPTION_STATES,
];

export const emailSubscriptionMachine = setupEffect({
  schemas: {
    context: Schema.Struct({
      alreadyVerified: Schema.Boolean,
      deferredNoAccess: Schema.Boolean,
    }),
    events: {
      activate: Schema.Struct({ type: Schema.Literal("activate") }),
      pause: Schema.Struct({ type: Schema.Literal("pause") }),
      request: Schema.Struct({ type: Schema.Literal("request") }),
      resume: Schema.Struct({ type: Schema.Literal("resume") }),
      unsubscribe: Schema.Struct({ type: Schema.Literal("unsubscribe") }),
      verify: Schema.Struct({ type: Schema.Literal("verify") }),
    },
  },
}).createMachine({
  context: { alreadyVerified: false, deferredNoAccess: false },
  id: "emailSubscription",
  initial: "none",
  states: {
    // No row yet. What a first request creates depends on what the caller
    // knows about the subject, so this is the one place `request` is not a
    // no-op.
    none: {
      on: {
        request: ({ context }: { context: SubscriptionContext }) =>
          context.alreadyVerified
            ? { target: "active" }
            : context.deferredNoAccess
              ? { target: "deferred_no_access" }
              : { target: "pending_verification" },
      },
    },
    // An address nobody has confirmed. It receives nothing until it is
    // verified, and a repeat request keeps the pending token rather than
    // clearing it.
    pending_verification: {
      on: {
        request: ({ context }: { context: SubscriptionContext }) =>
          context.alreadyVerified
            ? { target: "active" }
            : { target: "pending_verification" },
        unsubscribe: { target: "unsubscribed" },
        verify: { target: "active" },
      },
    },
    // Live. Plan pauses are reversible and do not touch consent.
    active: {
      on: {
        request: { target: "active" },
        pause: { target: "paused_by_plan" },
        unsubscribe: { target: "unsubscribed" },
      },
    },
    // Reversible: the workspace's plan stopped allowing email, the person did
    // not change their mind.
    paused_by_plan: {
      on: {
        request: ({ context }: { context: SubscriptionContext }) =>
          context.alreadyVerified
            ? { target: "active" }
            : { target: "paused_by_plan" },
        resume: { target: "active" },
        unsubscribe: { target: "unsubscribed" },
      },
    },
    // Terminal: the person's own consent decision. Only verifying the address
    // again outranks it, which is a fresh consent, not a state change.
    unsubscribed: {
      on: {
        request: ({ context }: { context: SubscriptionContext }) =>
          context.alreadyVerified
            ? { target: "active" }
            : { target: "unsubscribed" },
      },
    },
    // The subject has no verified account with access yet. Linking their
    // identity activates these; nothing else does. A request that finds access
    // gone falls back to pending rather than staying deferred.
    deferred_no_access: {
      on: {
        activate: { target: "active" },
        request: ({ context }: { context: SubscriptionContext }) =>
          context.alreadyVerified
            ? { target: "active" }
            : context.deferredNoAccess
              ? { target: "deferred_no_access" }
              : { target: "pending_verification" },
        unsubscribe: { target: "unsubscribed" },
      },
    },
  },
});

const snapshotFor = (
  node: TEmailSubscriptionNode,
  context: SubscriptionContext = {
    alreadyVerified: false,
    deferredNoAccess: false,
  }
) => emailSubscriptionMachine.resolveState({ context, value: node });

const stateAfter = (
  node: TEmailSubscriptionNode,
  event: TEmailSubscriptionEvent | "request"
): TEmailSubscriptionNode => {
  const [next] = transition(emailSubscriptionMachine, snapshotFor(node), {
    type: event,
  });
  // SAFETY: the machine is flat — every state and target is one of the five
  // stored states or `none` — and `subscription-machine.test.ts` walks the
  // whole graph rather than trusting this comment.
  return next.value as TEmailSubscriptionNode;
};

/**
 * The state a consent request lands in.
 *
 * This is the old `verifiedStateFor`, as data. `prior` is undefined when no
 * row exists yet; `alreadyVerified` means the caller proved the address in
 * this request, which outranks every stored state — verifying is consent.
 */
export const nextStateForRequest = (
  prior: TEmailSubscriptionState | undefined,
  context: SubscriptionContext
): TEmailSubscriptionState => {
  const [next] = transition(
    emailSubscriptionMachine,
    snapshotFor(prior ?? "none", context),
    { type: "request" }
  );
  // SAFETY: as above, and `request` never targets `none`, so a request can only
  // answer with a stored state.
  return next.value as TEmailSubscriptionState;
};

/**
 * The states from which `event` moves the subscription.
 *
 * Every one of these four events has distinct sources and targets — no state
 * takes an event and stays put — so a state is a source exactly when it is not
 * already the target.
 */
export const sourceStatesFor = (
  event: TEmailSubscriptionEvent
): readonly TEmailSubscriptionState[] =>
  EMAIL_SUBSCRIPTION_STATES.filter(
    (state) => stateAfter(state, event) !== state
  );

/** The single state `event` produces, for the `SET` half of a guarded update. */
export const targetStateFor = (
  event: TEmailSubscriptionEvent
): TEmailSubscriptionState => {
  const targets = new Set<TEmailSubscriptionState>();
  for (const state of EMAIL_SUBSCRIPTION_STATES) {
    const next = stateAfter(state, event);
    // Only a move counts: an event a state does not handle returns that state,
    // and counting it would make the target ambiguous.
    if (next !== state && next !== "none") {
      targets.add(next);
    }
  }
  const [target, ...rest] = [...targets];

  if (target === undefined || rest.length > 0) {
    throw new Error(
      `Email subscription event "${event}" must have exactly one target, found ${targets.size}`
    );
  }

  return target;
};

/** True when the machine permits the move, used by the tests. */
export const canTransitionSubscription = (
  from: TEmailSubscriptionState,
  to: TEmailSubscriptionState
): boolean =>
  EMAIL_SUBSCRIPTION_EVENTS.some(
    (event) =>
      sourceStatesFor(event).includes(from) && targetStateFor(event) === to
  );

export const EMAIL_SUBSCRIPTION_NODES = NODES;

import * as Schema from "effect/Schema";
import { setup } from "xstate";

/**
 * The lifecycle of what the analytics tracker believes it is talking to, as an
 * XState machine.
 *
 * The effect this replaces held the same lifecycle in one `useRef` and one
 * `if`/`else` chain:
 *
 * ```ts
 * if (userId === null) { if (identified.current !== null) reset(); }
 * else { if (identified.current !== userId) reset(); identify(…); }
 * ```
 *
 * The states were real — `identified` means "the tracker holds a profile", and
 * it is the only state a sign-out may reset — but nothing said so, and the two
 * rules that decide whether a reset happens were spelled out as comparisons
 * against a ref that a reader has to simulate. Three of the four cells are
 * traps:
 *
 * - a cold anonymous load must **not** reset, or every visitor gets a fresh
 *   session id on every page load;
 * - a sign-out must reset **exactly once**, not once per re-resolution;
 * - a switch from one user to another must reset **before** identifying, or
 *   the second user's events land on the first user's profile.
 *
 * Declaring them makes each one a transition a test can walk.
 *
 * XState 6 removed `actions` from transition objects: a transition function
 * receives `(args, enq)` and enqueues a named action with
 * `enq(actions.name, params)`. That collapses the old split between a `guard`
 * and an `actions` array — the condition, the target and the effects sit in one
 * function, in the order they happen.
 *
 * This is a browser-only client flow with no Effect service and no durable row,
 * so it runs on XState's own interpreter (`@xstate/react`'s `useActorRef`), not
 * on `@xstate/effect`.
 */

/** Who the tracker is told it is. Scalars only, per Databuddy's profile model. */
export type AnalyticsIdentity = {
  readonly userId: string;
  readonly email: string;
  readonly name: string;
};

/**
 * The two calls the lifecycle makes, injected so a test can record them.
 *
 * Both are idempotent from the tracker's side — `identify` re-sends traits for
 * a user it already knows, and `reset` on an already-anonymous visitor only
 * costs a fresh anonymous id — but the order of the pair is not, which is why
 * `forget` and `identify` are separate rather than one `switchTo`.
 */
export type AnalyticsIdentitySink = {
  readonly identify: (identity: AnalyticsIdentity) => void;
  readonly forget: () => void;
};

/** A resolved session: signed in, or definitely not. `loading` sends nothing. */
export type SessionEvent = {
  readonly type: "SESSION";
  readonly session: AnalyticsIdentity | null;
};

const IdentitySchema = Schema.Struct({
  email: Schema.String,
  name: Schema.String,
  userId: Schema.String,
});

/**
 * XState only validates at runtime when a `validator` is configured, so these
 * schemas exist for their types: without them `context` and `event` would be
 * `Record<string, any>` and every read in a transition would go unchecked.
 */
const IdentityContextSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ identity: Schema.NullOr(IdentitySchema) })
);

const SessionEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({
    session: Schema.NullOr(IdentitySchema),
    type: Schema.Literal("SESSION"),
  })
);

/**
 * Builds the machine around one sink. The factory exists so a test can supply
 * its own pair of calls instead of mocking `@databuddy/sdk`; everything else —
 * the states, the comparisons, the ordering — is the real machine.
 */
export const createAnalyticsIdentityMachine = (sink: AnalyticsIdentitySink) =>
  setup({
    actions: {
      /** Tell the tracker who this is, and error reporting with it. */
      identify: (identity: AnalyticsIdentity) => sink.identify(identity),
      /** Drop the profile, and the error-reporting user with it. */
      forget: () => sink.forget(),
    },
    schemas: {
      context: IdentityContextSchema,
      events: { SESSION: SessionEventSchema },
    },
  }).createMachine({
    context: { identity: null },
    id: "analyticsIdentity",
    initial: "unidentified",
    states: {
      // The tracker holds no profile. Nothing here may reset: this is the state
      // of every first page load, and resetting it would mint a new anonymous
      // id per load and split each visitor's history into pieces.
      unidentified: {
        on: {
          SESSION: (args, enq) => {
            const { event } = args;
            if (event.session === null) {
              // Still nobody signed in. There is nothing to forget, so this is
              // not a transition at all.
              return undefined;
            }
            enq(args.actions.identify, event.session);
            return {
              context: { identity: event.session },
              target: "identified",
            };
          },
        },
      },
      // The tracker holds a profile. Every way out of here is a reset, because
      // the profile must not outlive the session that created it.
      identified: {
        on: {
          SESSION: (args, enq) => {
            const { context, event } = args;
            if (event.session === null) {
              enq(args.actions.forget);
              return { context: { identity: null }, target: "unidentified" };
            }
            if (event.session.userId === context.identity?.userId) {
              // The same person, with traits that may have changed (a rename
              // elsewhere in the app). Re-sending the traits keeps the profile
              // current without mooting its identity.
              enq(args.actions.identify, event.session);
              return { context: { identity: event.session } };
            }
            // A different person on the same browser: forget first, so nothing
            // the second user does can land on the first user's profile.
            enq(args.actions.forget);
            enq(args.actions.identify, event.session);
            return { context: { identity: event.session } };
          },
        },
      },
    },
  });

/**
 * The states the machine declares, so a test can pin the set and the
 * `identified ⟺ identity !== null` agreement between state and context.
 */
export const ANALYTICS_IDENTITY_STATES = [
  "unidentified",
  "identified",
] as const;

export type AnalyticsIdentityState = (typeof ANALYTICS_IDENTITY_STATES)[number];

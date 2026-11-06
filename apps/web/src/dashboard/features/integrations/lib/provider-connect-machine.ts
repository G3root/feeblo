import * as Schema from "effect/Schema";
import { setup } from "xstate";

/**
 * The lifecycle of "connect this provider", as an XState machine.
 *
 * GitHub, Slack and Discord each held this flow in one `useState` boolean and
 * a try/catch: `connecting` disabled the button, the request returned an
 * authorize URL, and `window.location.assign` left the page. Three copies, and
 * a shape that could not say the one thing that matters — that the request has
 * *finished* and the browser is now leaving. That distinction is `redirecting`,
 * and naming it buys the recovery the boolean could not express: if the
 * navigation is blocked or silently ignored (an embedded frame, a `beforeunload`
 * handler, a browser that refuses a cross-origin assignment), `redirecting`
 * times out and the button comes back. With a boolean the page sat on a
 * disabled "Opening GitHub…" button until the user reloaded.
 *
 * The request itself is not an `invoke` here. It is one mutation whose failure
 * the caller has to toast anyway, and the toast is written where the error is
 * known — so the hook sends `REQUEST`, awaits, and reports `AUTHORIZED` or
 * `FAILED`. Keeping it out of the graph is also what lets this file be
 * context-free and its transitions be driven by a plain `transition()` call.
 */

/** How long the page waits for a navigation it asked for before offering the button again. */
export const PROVIDER_REDIRECT_TIMEOUT_MS = 5000;

/**
 * XState only validates at runtime when a `validator` is configured, so these
 * schemas exist for their types.
 */
const RequestEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("REQUEST") })
);
const AuthorizedEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("AUTHORIZED") })
);
const FailedEventSchema = Schema.toStandardSchemaV1(
  Schema.Struct({ type: Schema.Literal("FAILED") })
);

export const providerConnectMachine = setup({
  schemas: {
    events: {
      AUTHORIZED: AuthorizedEventSchema,
      FAILED: FailedEventSchema,
      REQUEST: RequestEventSchema,
    },
  },
}).createMachine({
  id: "providerConnect",
  initial: "idle",
  states: {
    // Also where a failed attempt lands. The failure is the toast, which the
    // caller shows; there is nothing left for the button to say, so a separate
    // `failed` state would render identically to this one.
    idle: {
      on: { REQUEST: { target: "requesting" } },
    },
    requesting: {
      on: {
        AUTHORIZED: { target: "redirecting" },
        FAILED: { target: "idle" },
      },
    },
    // The page has an authorize URL and has asked the browser to leave. Nothing
    // in this app returns from here — the provider's callback lands on a fresh
    // page load — so the only way out is the navigation not happening.
    redirecting: {
      after: {
        [PROVIDER_REDIRECT_TIMEOUT_MS]: { target: "idle" },
      },
    },
  },
});

/**
 * The two fields of a running actor's snapshot this module reads. Structural
 * rather than `SnapshotFrom<…>` because `@xstate/react` widens the snapshot's
 * `status` for its own subscribe helpers.
 */
export type ProviderConnectSnapshot = {
  readonly matches: (state: string) => boolean;
};

/** What the connect button renders. */
export type ProviderConnectStatus = "idle" | "requesting" | "redirecting";

export const toProviderConnectStatus = (
  snapshot: ProviderConnectSnapshot
): ProviderConnectStatus => {
  if (snapshot.matches("requesting")) {
    return "requesting";
  }
  if (snapshot.matches("redirecting")) {
    return "redirecting";
  }
  return "idle";
};

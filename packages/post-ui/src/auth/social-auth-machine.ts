import { useMachine } from "@xstate/react";
import { useCallback } from "react";
import { createAsyncLogic, setup } from "xstate";
import { z } from "zod";

import { type SocialProvider, signInWithSocialProvider } from "./auth-flows";

/**
 * Starting a social sign-in, as an XState machine.
 *
 * `useState<SocialProvider | null>` held this before, and it was the whole
 * lifecycle: the two buttons asked it whether to disable themselves and which
 * one should show a spinner. It is an implicit machine — `idle` and
 * `starting` are the states, and the provider is what distinguishes the latter
 * — and spelling it out fixes a hole the flag had: the handler reset the flag
 * *after* `await signInWithSocialProvider(...)`, so a call that threw left both
 * buttons disabled forever. `invoke` owns that pair of outcomes, so a failure
 * returns to `idle` the same way a success does.
 *
 * The provider is modelled as part of the state name rather than a nullable
 * field on the context: "starting with Google" and "starting with GitHub" are
 * different states of the same button pair, and neither can be entered without
 * a provider. That avoids the alternative — a `SocialProvider | null` in
 * context whose non-null case the invoke would have to assert — and it keeps
 * the graph flat, since a compound `starting` would need an `initial` substate
 * that a dynamic target never uses.
 *
 * XState 6 removed `assign` and the `guard` key, and has no `fromPromise`: the
 * request is a `createAsyncLogic` child, and a transition is a target string, a
 * `{ target, context }` patch, or a function returning one.
 */

/** What the buttons render: which provider is starting, if any. */
export type SocialAuthState = {
  readonly startingProvider: SocialProvider | null;
};

type SignInInput = {
  readonly provider: SocialProvider;
  readonly redirectTo: string | undefined;
};

const ContextSchema = z.object({
  redirectTo: z.union([z.string(), z.undefined()]),
});

/**
 * One list, three consumers: the event schema validates against it, the state
 * `Record` is exhaustive over it, and the projection walks it. Adding a provider
 * to `-flows.ts` without adding it here fails to compile at the `satisfies`.
 */
const providers = [
  "github",
  "google",
] as const satisfies readonly SocialProvider[];

const StartEventSchema = z.object({
  type: z.literal("START"),
  provider: z.enum(providers),
});

const InputSchema = z.object({
  redirectTo: z.union([z.string(), z.undefined()]),
});

/**
 * The provider call itself, injected rather than imported by the machine so a
 * test can answer it without a network.
 *
 * It resolves on failure too: `signInWithSocialProvider` reports the error as a
 * toast and returns, so "the browser is about to leave the page" and "the
 * attempt failed" are the same settlement from here. The ring is the redirect;
 * what the machine needs is only when the attempt is over.
 */
export type StartSocialSignIn = (input: SignInInput) => Promise<void>;

const startSocialSignIn: StartSocialSignIn = ({ provider, redirectTo }) =>
  signInWithSocialProvider({ provider, redirectTo });

/**
 * One state per provider, named so a reader can see which button is in flight.
 * The `Record` is exhaustive, so adding a provider without giving it a state is
 * a compile error rather than a button that never shows a spinner.
 */
const startingStateByProvider = {
  github: "startingGithub",
  google: "startingGoogle",
} as const satisfies Record<(typeof providers)[number], string>;

const startState = (provider: SocialProvider) => ({
  invoke: {
    src: "startSocialSignIn" as const,
    input: ({ context }: { context: z.infer<typeof ContextSchema> }) => ({
      provider,
      redirectTo: context.redirectTo,
    }),
    // Both outcomes land back in `idle`: a success is a navigation the browser
    // is already performing, and a failure has already surfaced its toast.
    onDone: { target: "idle" as const },
    onError: { target: "idle" as const },
  },
});

export const createSocialAuthMachine = (start: StartSocialSignIn) =>
  setup({
    actors: {
      startSocialSignIn: createAsyncLogic<void, SignInInput>({
        run: ({ input }) => start(input),
      }),
    },
    schemas: {
      context: ContextSchema,
      events: { START: StartEventSchema },
      input: InputSchema,
    },
  }).createMachine({
    context: ({ input }: { input: z.infer<typeof InputSchema> }) => ({
      redirectTo: input.redirectTo,
    }),
    id: "socialAuth",
    initial: "idle",
    states: {
      idle: {
        on: {
          START: ({ event }: { event: z.infer<typeof StartEventSchema> }) => ({
            target: startingStateByProvider[event.provider],
          }),
        },
      },
      startingGithub: startState("github"),
      startingGoogle: startState("google"),
    },
  });

/** The machine the app runs, wired to the real provider call. */
export const socialAuthMachine = createSocialAuthMachine(startSocialSignIn);

/**
 * The two fields of a running snapshot this module reads. Structural rather
 * than `SnapshotFrom<…>` because `@xstate/react` widens the snapshot for its
 * own subscribe helpers.
 */
export type SocialAuthSnapshot = {
  readonly matches: (state: string) => boolean;
};

/** Collapses a snapshot into the one value the buttons render. */
export const toSocialAuthState = (
  snapshot: SocialAuthSnapshot
): SocialAuthState => ({
  startingProvider:
    providers.find((provider) =>
      snapshot.matches(startingStateByProvider[provider])
    ) ?? null,
});

export type SocialAuth = SocialAuthState & {
  /** Called by whichever button was pressed. */
  readonly start: (provider: SocialProvider) => void;
};

/** The adapter between React's render cycle and the machine. */
export function useSocialAuth(redirectTo: string | undefined): SocialAuth {
  const [snapshot, send] = useMachine(socialAuthMachine, {
    input: { redirectTo },
  });

  const start = useCallback(
    (provider: SocialProvider) => {
      send({ type: "START", provider });
    },
    [send]
  );

  return { ...toSocialAuthState(snapshot), start };
}

import { describe, expect, it } from "vitest";
import { createActor } from "xstate";

import type { SocialProvider } from "./auth-flows";
import {
  type SocialAuthSnapshot,
  type StartSocialSignIn,
  createSocialAuthMachine,
  toSocialAuthState,
} from "./social-auth-machine";

/**
 * The buttons' lifecycle, driven through the real interpreter with an injected
 * provider call — the machine's `invoke` and its two outcomes are the part the
 * previous `useState<SocialProvider | null>` got wrong, so they are what the
 * tests pin.
 */

type PendingStart = {
  readonly provider: SocialProvider;
  readonly redirectTo: string | undefined;
  readonly settle: () => void;
  readonly fail: () => void;
};

const createHarness = (redirectTo?: string) => {
  const starts: PendingStart[] = [];

  const start: StartSocialSignIn = ({ provider, redirectTo: to }) =>
    new Promise<void>((settle, fail) => {
      starts.push({
        fail: () => fail(new Error("network")),
        provider,
        redirectTo: to,
        settle,
      });
    });

  const actor = createActor(createSocialAuthMachine(start), {
    input: { redirectTo },
  }).start();

  const state = () =>
    toSocialAuthState(
      // SAFETY: this is the live actor's own snapshot, which carries the
      // `matches` this module reads; the structural type exists only because
      // `@xstate/react` widens the snapshot's `status`.
      actor.getSnapshot() as SocialAuthSnapshot
    );

  return { actor, state, starts };
};

describe("social auth machine", () => {
  it("starts idle with no provider in flight", () => {
    const { state } = createHarness();

    expect(state().startingProvider).toBeNull();
  });

  it("starts only the pressed provider", () => {
    const { actor, state, starts } = createHarness();

    actor.send({ type: "START", provider: "google" });

    expect(state().startingProvider).toBe("google");
    expect(starts.map((call) => call.provider)).toEqual(["google"]);
  });

  it("passes the page's redirect through to the provider call", () => {
    const { actor, starts } = createHarness("/org_1/post/board/slug");

    actor.send({ type: "START", provider: "github" });

    expect(starts[0]?.redirectTo).toBe("/org_1/post/board/slug");
  });

  it("returns to idle when the attempt settles", async () => {
    const { actor, state, starts } = createHarness();

    actor.send({ type: "START", provider: "google" });
    starts[0]?.settle();

    // Let the invoked promise's resolution reach the actor.
    await Promise.resolve();

    expect(state().startingProvider).toBeNull();
  });

  it("returns to idle when the attempt fails", async () => {
    const { actor, state, starts } = createHarness();

    actor.send({ type: "START", provider: "github" });
    starts[0]?.fail();

    await Promise.resolve();

    // The bug this machine replaces: a rejected call left both buttons
    // disabled, because the flag was cleared after the `await` that threw.
    expect(state().startingProvider).toBeNull();
  });
});

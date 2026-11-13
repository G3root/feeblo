import { beforeEach, describe, expect, it } from "vitest";
import { createActor, transition } from "xstate";

import {
  ANALYTICS_IDENTITY_STATES,
  type AnalyticsIdentity,
  type AnalyticsIdentitySink,
  type AnalyticsIdentityState,
  type SessionEvent,
  createAnalyticsIdentityMachine,
} from "./analytics-identity-machine";

/**
 * The machine is the whole lifecycle, so these tests drive the actor the way
 * the provider does — send a resolved session, read what the tracker was told —
 * and assert on the calls a real run would make.
 *
 * The sink is injected through the factory, so the interpreter is real and the
 * three rules that are easy to get wrong (never reset on a cold load, reset
 * exactly once on sign-out, reset before identifying somebody else) are each a
 * case below rather than a comment.
 */

const ada: AnalyticsIdentity = {
  userId: "usr_ada",
  email: "ada@example.com",
  name: "Ada Lovelace",
};

const grace: AnalyticsIdentity = {
  userId: "usr_grace",
  email: "grace@example.com",
  name: "Grace Hopper",
};

describe("analytics identity machine", () => {
  let calls: string[];
  let machine: ReturnType<typeof createAnalyticsIdentityMachine>;

  const sink: AnalyticsIdentitySink = {
    identify: (identity) => calls.push(`identify:${identity.userId}`),
    forget: () => calls.push("forget"),
  };

  const start = () => createActor(machine).start();

  const session = (value: AnalyticsIdentity | null) =>
    ({ type: "SESSION", session: value }) satisfies SessionEvent;

  beforeEach(() => {
    calls = [];
    machine = createAnalyticsIdentityMachine(sink);
  });

  it("declares exactly the two states of the lifecycle", () => {
    expect(Object.keys(machine.states).sort()).toStrictEqual(
      [...ANALYTICS_IDENTITY_STATES].sort()
    );
  });

  it("starts unidentified, holding no profile", () => {
    const snapshot = machine.getInitialSnapshot();

    expect(snapshot.value).toBe("unidentified");
    expect(snapshot.context.identity).toBeNull();
  });

  it("tells a cold anonymous load nothing, and resets nothing", () => {
    // The bug this replaces: resetting here mints a new anonymous id on every
    // page load, so one visitor's history arrives as a new visitor each time.
    const actor = start();
    actor.send(session(null));

    expect(calls).toStrictEqual([]);
    expect(actor.getSnapshot().value).toBe("unidentified");
  });

  it("identifies a first sign-in", () => {
    const actor = start();
    actor.send(session(ada));

    expect(calls).toStrictEqual(["identify:usr_ada"]);
    expect(actor.getSnapshot().value).toBe("identified");
    expect(actor.getSnapshot().context.identity).toStrictEqual(ada);
  });

  it("re-sends traits for the same user instead of resetting them", () => {
    const actor = start();
    actor.send(session(ada));
    calls = [];

    // A rename elsewhere in the app re-resolves the session with new traits.
    // The profile is the same person, so its identity must survive.
    actor.send(session({ ...ada, name: "Ada King" }));

    expect(calls).toStrictEqual(["identify:usr_ada"]);
    expect(actor.getSnapshot().value).toBe("identified");
    expect(actor.getSnapshot().context.identity?.name).toBe("Ada King");
  });

  it("forgets the profile exactly once on sign-out", () => {
    const actor = start();
    actor.send(session(ada));
    calls = [];

    actor.send(session(null));
    expect(calls).toStrictEqual(["forget"]);
    expect(actor.getSnapshot().value).toBe("unidentified");
    expect(actor.getSnapshot().context.identity).toBeNull();

    // A second resolution of the same signed-out session is not a transition:
    // resetting again would mint another anonymous id for no reason.
    actor.send(session(null));
    expect(calls).toStrictEqual(["forget"]);
  });

  it("forgets before identifying a different user on the same browser", () => {
    const actor = start();
    actor.send(session(ada));
    calls = [];

    actor.send(session(grace));

    // Order is the assertion: identifying first would attach whatever Grace
    // does next to Ada's profile.
    expect(calls).toStrictEqual(["forget", "identify:usr_grace"]);
    expect(actor.getSnapshot().context.identity).toStrictEqual(grace);
  });

  it("keeps the state and the context in agreement in every cell", () => {
    // `identified` is only meaningful if it means exactly "the context holds a
    // profile"; the moment the two can disagree, a reset can be skipped or
    // duplicated. This walks every state by every event and checks it.
    const events: readonly SessionEvent[] = [
      session(null),
      session(ada),
      session(grace),
    ];

    const reachable = new Set<AnalyticsIdentityState>(
      ANALYTICS_IDENTITY_STATES
    );
    const checked = new Set<string>();

    for (const from of reachable) {
      for (const event of events) {
        const snapshot = machine.resolveState({
          context: {
            identity: from === "identified" ? (event.session ?? ada) : null,
          },
          value: from,
        });

        const [next] = transition(machine, snapshot, event);
        // SAFETY: this machine declares no nested states, so `value` names a
        // member of `ANALYTICS_IDENTITY_STATES`; `StateValue` widens it to
        // `string | object` because XState also supports parallel states.
        const state = next.value as AnalyticsIdentityState;

        expect(reachable.has(state)).toBe(true);
        expect(state === "identified").toBe(next.context.identity !== null);
        checked.add(`${from}/${event.session?.userId ?? "none"}`);
      }
    }

    // Six cells, so a state or an event that stops being walked is visible.
    expect(checked.size).toBe(ANALYTICS_IDENTITY_STATES.length * events.length);
  });
});

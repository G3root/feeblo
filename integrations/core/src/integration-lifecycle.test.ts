import { describe, expect, it } from "vitest";

import {
  INTEGRATION_CONNECTION_STATES,
  INTEGRATION_DELIVERY_STATES,
  LEGACY_CONNECTION_LIFECYCLES,
  LISTED_CONNECTION_LIFECYCLES,
  canTransitionIntegrationConnectionLifecycle,
  canTransitionIntegrationDeliveryState,
  connectionSourceStatesFor,
  deliveryHandles,
  deliverySourceStatesFor,
  integrationConnectionMachine,
} from "./integration-lifecycle";

/**
 * Both graphs are derived from one machine each — the state list, the reverse
 * index and the predicates all read back off it — so these tests are what keep
 * the derivation honest. They enumerate the graphs rather than sampling them.
 */

const connections = INTEGRATION_CONNECTION_STATES;
const connectionPairs = connections.flatMap((from) =>
  connections.map((to) => [from, to] as const)
);

const connectionTransitions = connectionPairs
  .filter(([from, to]) =>
    canTransitionIntegrationConnectionLifecycle({ from, to })
  )
  .map(([from, to]) => `${from} -> ${to}`);

describe("integration connection lifecycle", () => {
  it("declares every state the stored vocabulary allows", () => {
    expect([...connections].sort()).toStrictEqual([
      "active",
      "archived",
      "connecting",
      "disconnected",
      "disconnecting",
      "paused",
      "reauth_required",
      "revocation_unconfirmed",
    ]);
  });

  it("permits documented connection transitions and rejects lifecycle skips", () => {
    expect(
      canTransitionIntegrationConnectionLifecycle({
        from: "active",
        to: "disconnecting",
      })
    ).toBe(true);
    // Archiving without a disconnect step is a real path: the webhook
    // provider's endpoint deletion locks the row and archives it directly, and
    // a GitHub installation deletion arrives as a remote fact with no local
    // preconditions. The graph says so instead of pretending otherwise.
    expect(
      canTransitionIntegrationConnectionLifecycle({
        from: "active",
        to: "archived",
      })
    ).toBe(true);
    expect(
      canTransitionIntegrationConnectionLifecycle({
        from: "connecting",
        to: "paused",
      })
    ).toBe(false);
    expect(
      canTransitionIntegrationConnectionLifecycle({
        from: "archived",
        to: "disconnecting",
      })
    ).toBe(false);
  });

  it("allows exactly the documented transition set", () => {
    expect(connectionTransitions).toStrictEqual([
      "connecting -> active",
      "connecting -> disconnecting",
      "connecting -> archived",
      "active -> active",
      "active -> paused",
      "active -> disconnecting",
      "active -> archived",
      "paused -> active",
      "paused -> disconnecting",
      "paused -> archived",
      "reauth_required -> active",
      "reauth_required -> disconnecting",
      "reauth_required -> archived",
      "disconnecting -> revocation_unconfirmed",
      "disconnecting -> archived",
      "disconnected -> active",
      "disconnected -> archived",
      "revocation_unconfirmed -> disconnecting",
      "revocation_unconfirmed -> archived",
    ]);
  });

  it("treats archived as the only terminal state", () => {
    const terminal = connections.filter(
      (state) =>
        !connections.some(
          (to) =>
            to !== state &&
            canTransitionIntegrationConnectionLifecycle({ from: state, to })
        )
    );

    expect(terminal).toStrictEqual(["archived"]);
  });

  it("derives the list filter from the graph", () => {
    // The three provider list queries wrote these seven names out by hand.
    // "Listed" and "can still be archived" are the same set.
    expect(LISTED_CONNECTION_LIFECYCLES).toStrictEqual(
      connections.filter((state) => state !== "archived")
    );
    expect([...connectionSourceStatesFor("archived")]).toStrictEqual([
      ...LISTED_CONNECTION_LIFECYCLES,
    ]);
  });

  it("keeps the legacy states drain-only", () => {
    // Nothing writes `reauth_required` or `disconnected` any more; old rows may
    // still hold one, so they keep their outgoing edges. What must not exist is
    // an edge *into* them, or the code could create one again.
    for (const legacy of LEGACY_CONNECTION_LIFECYCLES) {
      const inbound = connections.filter(
        (from) =>
          from !== legacy &&
          canTransitionIntegrationConnectionLifecycle({
            from,
            to: legacy,
          })
      );

      expect(inbound).toStrictEqual([]);
    }

    // They are still sources, which is how an old row gets archived.
    expect(connectionSourceStatesFor("active")).toContain("disconnected");
    expect(connectionSourceStatesFor("disconnecting")).toContain(
      "reauth_required"
    );
  });

  it("starts connecting", () => {
    expect(integrationConnectionMachine.getInitialSnapshot().value).toBe(
      "connecting"
    );
  });

  it("re-derives the state list from the machine, not a second copy", () => {
    // The list is `Object.keys(machine.states)`; this is the assertion that
    // fails the day a state is added to one and not the other.
    expect([...connections].sort()).toStrictEqual(
      Object.keys(integrationConnectionMachine.states).sort()
    );
  });
});

describe("integration delivery state", () => {
  const deliveries = INTEGRATION_DELIVERY_STATES;
  const deliveryPairs = deliveries.flatMap((from) =>
    deliveries.map((to) => [from, to] as const)
  );

  it("allows manual retry only from exhausted and never revives canceled work", () => {
    expect(
      canTransitionIntegrationDeliveryState({
        from: "exhausted",
        to: "pending",
      })
    ).toBe(true);
    expect(
      canTransitionIntegrationDeliveryState({ from: "canceled", to: "pending" })
    ).toBe(false);
  });

  it("allows exactly the documented transition set", () => {
    const transitions = deliveryPairs
      .filter(([from, to]) =>
        canTransitionIntegrationDeliveryState({ from, to })
      )
      .map(([from, to]) => `${from} -> ${to}`);

    // Declaration order of the states, then of the edges out of each one:
    // `canceled` is declared before `leased`, and `exhausted` after both.
    expect(transitions).toStrictEqual([
      "pending -> leased",
      "pending -> canceled",
      "leased -> pending",
      "leased -> succeeded",
      "leased -> exhausted",
      "leased -> canceled",
      "exhausted -> pending",
    ]);
  });

  it("derives each event's sources", () => {
    expect(deliverySourceStatesFor("canceled")).toStrictEqual([
      "pending",
      "leased",
    ]);
    expect(deliverySourceStatesFor("leased")).toStrictEqual(["pending"]);
    expect(deliverySourceStatesFor("pending")).toStrictEqual([
      "leased",
      "exhausted",
    ]);
    expect(deliverySourceStatesFor("succeeded")).toStrictEqual(["leased"]);
    expect(deliverySourceStatesFor("exhausted")).toStrictEqual(["leased"]);
  });

  it("has no self-transition", () => {
    // `deliverySourceStatesFor` filters `from === to` out, so asserting it
    // does not contain the target would pass whether or not a self-edge
    // exists. The predicate itself is the only witness.
    for (const state of deliveries) {
      expect(deliveryHandles(state, state)).toBe(false);
    }
  });

  it("declares every delivery state", () => {
    expect([...deliveries].sort()).toStrictEqual([
      "canceled",
      "exhausted",
      "leased",
      "pending",
      "succeeded",
    ]);
  });
});

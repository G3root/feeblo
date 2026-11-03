import { describe, expect, it } from "vitest";

import {
  INTEGRATION_CONNECTION_EVENTS,
  INTEGRATION_CONNECTION_STATES,
  INTEGRATION_DELIVERY_EVENTS,
  INTEGRATION_DELIVERY_STATES,
  LEGACY_CONNECTION_LIFECYCLES,
  LISTED_CONNECTION_LIFECYCLES,
  canTransitionIntegrationConnectionLifecycle,
  canTransitionIntegrationDeliveryState,
  connectionSourceStatesFor,
  connectionTargetStateFor,
  deliverySourceStatesFor,
  deliveryTargetStateFor,
  integrationConnectionMachine,
} from "./integration-lifecycle";
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
    expect([...connectionSourceStatesFor("archive")]).toStrictEqual([
      ...LISTED_CONNECTION_LIFECYCLES,
    ]);
  });

  it("keeps the legacy states drain-only", () => {
    // Nothing writes `reauth_required` or `disconnected` any more; old rows may
    // still hold one, so they keep their outgoing edges. What must not exist is
    // an edge *into* them: no event may target a legacy state, or the code
    // would be able to create one again.
    for (const event of INTEGRATION_CONNECTION_EVENTS) {
      expect(LEGACY_CONNECTION_LIFECYCLES).not.toContain(
        connectionTargetStateFor(event)
      );
    }

    // They are still sources, which is how an old row gets archived.
    expect(connectionSourceStatesFor("activate")).toContain("disconnected");
    expect(connectionSourceStatesFor("disconnect")).toContain(
      "reauth_required"
    );
    expect(connectionSourceStatesFor("archive")).toContain("reauth_required");
  });

  it("starts connecting", () => {
    expect(integrationConnectionMachine.getInitialSnapshot().value).toBe(
      "connecting"
    );
  });

  it("gives every event exactly one target", () => {
    expect(
      INTEGRATION_CONNECTION_EVENTS.map(connectionTargetStateFor)
    ).toStrictEqual([
      "active",
      "archived",
      "disconnecting",
      "revocation_unconfirmed",
      "paused",
    ]);
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
    expect(deliverySourceStatesFor("cancel")).toStrictEqual([
      "pending",
      "leased",
    ]);
    expect(deliverySourceStatesFor("lease")).toStrictEqual(["pending"]);
    expect(deliverySourceStatesFor("release")).toStrictEqual(["leased"]);
    expect(deliverySourceStatesFor("retry")).toStrictEqual(["exhausted"]);
  });

  it("has no self-transition, so a generated WHERE can never miss a move", () => {
    // A self-transition would leave the value unchanged while still being a
    // move, and a `WHERE` generated from the sources would be missing it.
    for (const event of INTEGRATION_DELIVERY_EVENTS) {
      expect(deliverySourceStatesFor(event)).not.toContain(
        deliveryTargetStateFor(event)
      );
    }
  });
});

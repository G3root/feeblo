import { describe, expect, it } from "vitest";

import {
  doesIntegrationRouteMatchEvent,
  isSubscribableIntegrationEventType,
} from "./route-event-selection";

describe("doesIntegrationRouteMatchEvent", () => {
  const route = {
    enabled: true,
    eventTypes: ["feedback.post.created"] as const,
  };

  it("matches selected events only while the connection is active", () => {
    expect(
      doesIntegrationRouteMatchEvent({
        connectionLifecycleStatus: "active",
        event: { type: "feedback.post.created" },
        route,
      })
    ).toBe(true);
    expect(
      doesIntegrationRouteMatchEvent({
        connectionLifecycleStatus: "paused",
        event: { type: "feedback.post.created" },
        route,
      })
    ).toBe(false);
  });

  it("refuses webhook.test as a persistent subscription", () => {
    expect(isSubscribableIntegrationEventType("webhook.test")).toBe(false);
    expect(
      doesIntegrationRouteMatchEvent({
        connectionLifecycleStatus: "active",
        event: { type: "webhook.test" },
        route,
      })
    ).toBe(false);
  });
});

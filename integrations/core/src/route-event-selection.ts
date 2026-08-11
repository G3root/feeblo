import type {
  IntegrationConnectionLifecycleStatus,
  IntegrationEventEnvelopeV1,
  IntegrationRoute,
  SubscribableIntegrationEventType,
} from "./integration-contracts";

/** Identifies event names routes may persistently select; test events are excluded. */
export const isSubscribableIntegrationEventType = (
  eventType: IntegrationEventEnvelopeV1["type"]
): eventType is SubscribableIntegrationEventType =>
  eventType !== "webhook.test";

/** Matches an enabled route against an event without retaining webhook.test subscriptions. */
export const doesIntegrationRouteMatchEvent = ({
  connectionLifecycleStatus,
  event,
  route,
}: {
  readonly connectionLifecycleStatus: IntegrationConnectionLifecycleStatus;
  readonly event: Pick<IntegrationEventEnvelopeV1, "type">;
  readonly route: Pick<IntegrationRoute, "enabled" | "eventTypes">;
}): boolean =>
  connectionLifecycleStatus === "active" &&
  route.enabled &&
  isSubscribableIntegrationEventType(event.type) &&
  route.eventTypes.includes(event.type);

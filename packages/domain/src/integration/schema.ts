import {
  IntegrationConnectionLifecycleStatus,
  IntegrationDeliveryRetryDecision,
  IntegrationDeliveryState,
  IntegrationEventType,
  IntegrationRouteEventSelection,
} from "@feeblo/db/validation-schema/integration";
import {
  IntegrationConnectionId,
  IntegrationDeliveryAttemptId,
  IntegrationDeliveryId,
  IntegrationRouteId,
  WorkspaceId,
} from "@feeblo/id";
import * as Schema from "effect/Schema";

// Re-exported so client packages (e.g. webhook forms) can use the event-type
// vocabulary without importing `@feeblo/db` directly.
export { SUBSCRIBABLE_INTEGRATION_EVENT_TYPES } from "@feeblo/db/validation-schema/integration";

const EventSelection = IntegrationRouteEventSelection.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2)
);
const EndpointName = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(100)
);
const EndpointUrl = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(2048)
);
const Health = Schema.Literals(["healthy", "failing", "paused"]);

/** Safe endpoint listing row; never carries credentials or the endpoint URL. */
export const WebhookEndpoint = Schema.Struct({
  id: IntegrationConnectionId.schema,
  name: Schema.String,
  hostname: Schema.String,
  lifecycle: IntegrationConnectionLifecycleStatus,
  eventTypes: IntegrationRouteEventSelection,
  health: Health,
  lastSucceededAt: Schema.NullOr(Schema.DateFromString),
  lastFailedAt: Schema.NullOr(Schema.DateFromString),
});
export type TWebhookEndpoint = typeof WebhookEndpoint.Type;
/** Create-endpoint input; the endpoint URL is validated before persistence. */
export const WebhookEndpointCreate = Schema.Struct({
  organizationId: WorkspaceId.schema,
  name: EndpointName,
  endpointUrl: EndpointUrl,
  eventTypes: EventSelection,
});
export type TWebhookEndpointCreate = typeof WebhookEndpointCreate.Type;
/** Partial update input; only supplied fields are changed. */
export const WebhookEndpointUpdate = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
  name: Schema.optionalKey(EndpointName),
  endpointUrl: Schema.optionalKey(EndpointUrl),
  eventTypes: Schema.optionalKey(EventSelection),
});
export type TWebhookEndpointUpdate = typeof WebhookEndpointUpdate.Type;
/** Connection-scoped action input shared by pause, resume, remove, and rotation. */
export const WebhookConnectionAction = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
});
export type TWebhookConnectionAction = typeof WebhookConnectionAction.Type;
/** Create result; the signing secret is returned exactly once. */
export const WebhookEndpointCreated = Schema.Struct({
  endpoint: WebhookEndpoint,
  signingSecret: Schema.String,
});
export type TWebhookEndpointCreated = typeof WebhookEndpointCreated.Type;
/** Rotation result; the new signing secret is returned exactly once. */
export const WebhookSecretRotated = Schema.Struct({
  signingSecret: Schema.String,
});
export type TWebhookSecretRotated = typeof WebhookSecretRotated.Type;
/** Queues a synthetic `webhook.test` event and delivery for the endpoint. */
export const WebhookTestDelivery = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
});
export type TWebhookTestDelivery = typeof WebhookTestDelivery.Type;
/** Test-delivery result; the delivery is queued for the delivery worker. */
export const WebhookTestDeliveryResult = Schema.Struct({
  deliveryId: IntegrationDeliveryId.schema,
  result: Schema.Literal("queued"),
});
export type TWebhookTestDeliveryResult = typeof WebhookTestDeliveryResult.Type;
/** Keyset-paginated delivery history request for one connection. */
export const WebhookDeliveryHistory = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
  ),
});
export type TWebhookDeliveryHistory = typeof WebhookDeliveryHistory.Type;
/** One append-only execution attempt of a delivery; retryDecision is null while the attempt is in flight. */
export const WebhookDeliveryAttempt = Schema.Struct({
  id: IntegrationDeliveryAttemptId.schema,
  startedAt: Schema.DateFromString,
  completedAt: Schema.NullOr(Schema.DateFromString),
  durationMs: Schema.NullOr(Schema.Int),
  httpStatus: Schema.NullOr(Schema.Int),
  errorTag: Schema.NullOr(Schema.String),
  retryDecision: Schema.NullOr(IntegrationDeliveryRetryDecision),
});
export type TWebhookDeliveryAttempt = typeof WebhookDeliveryAttempt.Type;
/** One delivery with its attempts, newest first. */
export const WebhookDelivery = Schema.Struct({
  id: IntegrationDeliveryId.schema,
  routeId: IntegrationRouteId.schema,
  eventType: IntegrationEventType,
  state: IntegrationDeliveryState,
  attemptCount: Schema.Int,
  createdAt: Schema.DateFromString,
  nextAttemptAt: Schema.DateFromString,
  attempts: Schema.Array(WebhookDeliveryAttempt),
});
export type TWebhookDelivery = typeof WebhookDelivery.Type;
/** Delivery history page with an optional keyset cursor for the next page. */
export const WebhookDeliveryHistoryPage = Schema.Struct({
  items: Schema.Array(WebhookDelivery),
  nextCursor: Schema.NullOr(Schema.String),
});
export type TWebhookDeliveryHistoryPage =
  typeof WebhookDeliveryHistoryPage.Type;
/** Manual retry of an exhausted delivery of an active endpoint. */
export const WebhookManualRetry = Schema.Struct({
  organizationId: WorkspaceId.schema,
  deliveryId: IntegrationDeliveryId.schema,
});
export type TWebhookManualRetry = typeof WebhookManualRetry.Type;
/** Empty list-endpoints request scoped to one organization. */
export const WebhookEndpointList = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type TWebhookEndpointList = typeof WebhookEndpointList.Type;

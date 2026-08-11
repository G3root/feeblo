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
export const WebhookEndpointCreate = Schema.Struct({
  organizationId: WorkspaceId.schema,
  name: EndpointName,
  endpointUrl: EndpointUrl,
  eventTypes: EventSelection,
});
export type TWebhookEndpointCreate = typeof WebhookEndpointCreate.Type;
export const WebhookEndpointUpdate = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
  name: Schema.optionalKey(EndpointName),
  endpointUrl: Schema.optionalKey(EndpointUrl),
  eventTypes: Schema.optionalKey(EventSelection),
});
export type TWebhookEndpointUpdate = typeof WebhookEndpointUpdate.Type;
export const WebhookConnectionAction = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
});
export type TWebhookConnectionAction = typeof WebhookConnectionAction.Type;
export const WebhookEndpointCreated = Schema.Struct({
  endpoint: WebhookEndpoint,
  signingSecret: Schema.String,
});
export type TWebhookEndpointCreated = typeof WebhookEndpointCreated.Type;
export const WebhookSecretRotated = Schema.Struct({
  signingSecret: Schema.String,
});
export type TWebhookSecretRotated = typeof WebhookSecretRotated.Type;
export const WebhookTestDelivery = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
});
export type TWebhookTestDelivery = typeof WebhookTestDelivery.Type;
export const WebhookTestDeliveryResult = Schema.Struct({
  deliveryId: IntegrationDeliveryId.schema,
  result: Schema.Literal("queued"),
});
export type TWebhookTestDeliveryResult = typeof WebhookTestDeliveryResult.Type;
export const WebhookDeliveryHistory = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
  cursor: Schema.optionalKey(Schema.String),
  limit: Schema.optionalKey(
    Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 100 }))
  ),
});
export type TWebhookDeliveryHistory = typeof WebhookDeliveryHistory.Type;
export const WebhookDeliveryAttempt = Schema.Struct({
  id: IntegrationDeliveryAttemptId.schema,
  startedAt: Schema.DateFromString,
  completedAt: Schema.NullOr(Schema.DateFromString),
  durationMs: Schema.NullOr(Schema.Int),
  httpStatus: Schema.NullOr(Schema.Int),
  errorTag: Schema.NullOr(Schema.String),
  retryDecision: IntegrationDeliveryRetryDecision,
});
export type TWebhookDeliveryAttempt = typeof WebhookDeliveryAttempt.Type;
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
export const WebhookDeliveryHistoryPage = Schema.Struct({
  items: Schema.Array(WebhookDelivery),
  nextCursor: Schema.NullOr(Schema.String),
});
export type TWebhookDeliveryHistoryPage =
  typeof WebhookDeliveryHistoryPage.Type;
export const WebhookManualRetry = Schema.Struct({
  organizationId: WorkspaceId.schema,
  deliveryId: IntegrationDeliveryId.schema,
});
export type TWebhookManualRetry = typeof WebhookManualRetry.Type;
export const WebhookEndpointList = Schema.Struct({
  organizationId: WorkspaceId.schema,
});
export type TWebhookEndpointList = typeof WebhookEndpointList.Type;

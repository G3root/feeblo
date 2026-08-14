import * as S from "effect/Schema";

/** Canonical provider key stored by integration connections and routes. */
export const IntegrationProviderKey = S.NonEmptyString.pipe(
  S.brand("IntegrationProviderKey")
);
export type TIntegrationProviderKey = S.Schema.Type<
  typeof IntegrationProviderKey
>;

/** Provider-owned external resource kind, such as `issue`, `task`, or `ticket`. */
export const IntegrationExternalResourceType = S.NonEmptyString.pipe(
  S.brand("IntegrationExternalResourceType")
);
export type TIntegrationExternalResourceType = S.Schema.Type<
  typeof IntegrationExternalResourceType
>;

/** Durable external resource creation lifecycle. */
export const ExternalResourceCreateRequestState = S.Literals([
  "pending",
  "succeeded",
  "failed",
]);
export type TExternalResourceCreateRequestState = S.Schema.Type<
  typeof ExternalResourceCreateRequestState
>;

/** Canonical provider capability directions used by static manifests. */
export const IntegrationCapabilityDirection = S.Literals([
  "outbound",
  "inbound",
  "bidirectional",
]);
export type TIntegrationCapabilityDirection = S.Schema.Type<
  typeof IntegrationCapabilityDirection
>;

/** Provider connection mode declared by static manifests; providers own their auth modes and the startup registry validates them. */
export const IntegrationConnectionMode = S.NonEmptyString;
export type TIntegrationConnectionMode = S.Schema.Type<
  typeof IntegrationConnectionMode
>;

/** Provider capability key persisted by integration routes; providers own their keys and the startup registry validates them. */
export const IntegrationCapabilityKey = S.NonEmptyString;
export type TIntegrationCapabilityKey = S.Schema.Type<
  typeof IntegrationCapabilityKey
>;

/** Canonical event selection stored in `integration_route.event_types`. */
export const SUBSCRIBABLE_INTEGRATION_EVENT_TYPES = [
  "feedback.post.created",
  "feedback.post.status_changed",
] as const;
export const SubscribableIntegrationEventType = S.Literals(
  SUBSCRIBABLE_INTEGRATION_EVENT_TYPES
);
export type TSubscribableIntegrationEventType = S.Schema.Type<
  typeof SubscribableIntegrationEventType
>;
export const IntegrationRouteEventSelection = S.Array(
  SubscribableIntegrationEventType
);
export type TIntegrationRouteEventSelection = S.Schema.Type<
  typeof IntegrationRouteEventSelection
>;

/** Event type stored in `integration_event.type`; domain and provider events share one open vocabulary. */
export const IntegrationEventType = S.NonEmptyString;
export type TIntegrationEventType = S.Schema.Type<typeof IntegrationEventType>;

/** Canonical connection lifecycle stored in `integration_connection.lifecycle`. */
export const IntegrationConnectionLifecycleStatus = S.Literals([
  "connecting",
  "active",
  "paused",
  "reauth_required",
  "disconnecting",
  "disconnected",
  "revocation_unconfirmed",
  "archived",
]);
export type TIntegrationConnectionLifecycleStatus = S.Schema.Type<
  typeof IntegrationConnectionLifecycleStatus
>;

/** Canonical delivery lifecycle stored in `integration_delivery.state`. */
export const IntegrationDeliveryState = S.Literals([
  "pending",
  "leased",
  "succeeded",
  "exhausted",
  "canceled",
]);
export type TIntegrationDeliveryState = S.Schema.Type<
  typeof IntegrationDeliveryState
>;

/** Canonical attempt decision stored in `integration_delivery_attempt.retry_decision`. */
export const IntegrationDeliveryRetryDecision = S.Literals([
  "succeeded",
  "pending",
  "retry",
  "exhausted",
  "canceled",
]);
export type TIntegrationDeliveryRetryDecision = S.Schema.Type<
  typeof IntegrationDeliveryRetryDecision
>;

/** JSON objects explicitly safe to expose without provider credentials. */
export const IntegrationSafeDisplayMetadata = S.Record(S.String, S.Json);
export type TIntegrationSafeDisplayMetadata = S.Schema.Type<
  typeof IntegrationSafeDisplayMetadata
>;

/** Versioned provider-owned route configuration persisted as JSON. */
export const IntegrationProviderConfiguration = S.Json;
export type TIntegrationProviderConfiguration = S.Schema.Type<
  typeof IntegrationProviderConfiguration
>;

/** Immutable provider-neutral event snapshot persisted as JSON. */
export const StoredIntegrationEventPayload = S.Json;
export type TStoredIntegrationEventPayload = S.Schema.Type<
  typeof StoredIntegrationEventPayload
>;

/** Safe delivery failure summary; raw provider responses are never persisted. */
export const IntegrationDeliveryLastError = S.Struct({ errorTag: S.String });
export type TIntegrationDeliveryLastError = S.Schema.Type<
  typeof IntegrationDeliveryLastError
>;

/** Optional safe attempt diagnostics, excluding payloads, URLs, and credentials. */
export const IntegrationDeliveryAttemptDiagnostics = S.Record(S.String, S.Json);
export type TIntegrationDeliveryAttemptDiagnostics = S.Schema.Type<
  typeof IntegrationDeliveryAttemptDiagnostics
>;

/** Persisted event origin; core applies branded IDs after decoding the row. */
export const StoredIntegrationEventOrigin = S.Struct({
  kind: S.Literals(["feeblo", "provider"]),
  provider: S.optionalKey(IntegrationProviderKey),
  connectionId: S.optionalKey(S.NonEmptyString),
  routeId: S.optionalKey(S.NonEmptyString),
});
export type TStoredIntegrationEventOrigin = S.Schema.Type<
  typeof StoredIntegrationEventOrigin
>;

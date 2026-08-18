import {
  IntegrationCapabilityDirection as DbIntegrationCapabilityDirection,
  IntegrationCapabilityKey as DbIntegrationCapabilityKey,
  IntegrationConnectionLifecycleStatus as DbIntegrationConnectionLifecycleStatus,
  IntegrationConnectionMode as DbIntegrationConnectionMode,
  IntegrationDeliveryRetryDecision as DbIntegrationDeliveryRetryDecision,
  IntegrationDeliveryState as DbIntegrationDeliveryState,
  IntegrationEventType as DbIntegrationEventType,
  IntegrationExternalResourceType as DbIntegrationExternalResourceType,
  IntegrationProviderKey as DbIntegrationProviderKey,
  IntegrationRouteEventSelection as DbIntegrationRouteEventSelection,
  IntegrationSafeDisplayMetadata as DbIntegrationSafeDisplayMetadata,
  SubscribableIntegrationEventType as DbSubscribableIntegrationEventType,
  type TIntegrationCapabilityDirection,
  type TIntegrationCapabilityKey,
  type TIntegrationConnectionLifecycleStatus,
  type TIntegrationConnectionMode,
  type TIntegrationDeliveryState,
  type TIntegrationEventType,
  type TIntegrationExternalResourceType,
  type TIntegrationProviderKey,
  type TSubscribableIntegrationEventType,
} from "@feeblo/db/validation-schema/integration";
import { PostStatusType } from "@feeblo/db/validation-schema/post-status-type";
import {
  BoardId,
  IntegrationConnectionId,
  IntegrationDeliveryAttemptId,
  IntegrationDeliveryId,
  IntegrationEventId,
  IntegrationRouteId,
  MemberId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

export const IntegrationCapabilityDirection = DbIntegrationCapabilityDirection;
export const IntegrationCapabilityKey = DbIntegrationCapabilityKey;
export const IntegrationConnectionLifecycleStatus =
  DbIntegrationConnectionLifecycleStatus;
export const IntegrationConnectionMode = DbIntegrationConnectionMode;
export const IntegrationDeliveryRetryDecision =
  DbIntegrationDeliveryRetryDecision;
export const IntegrationDeliveryState = DbIntegrationDeliveryState;
export const IntegrationExternalResourceType =
  DbIntegrationExternalResourceType;
export const IntegrationEventType = DbIntegrationEventType;
export const IntegrationProviderKey = DbIntegrationProviderKey;
export const IntegrationRouteEventSelection = DbIntegrationRouteEventSelection;
export const IntegrationSafeDisplayMetadata = DbIntegrationSafeDisplayMetadata;
export const SubscribableIntegrationEventType =
  DbSubscribableIntegrationEventType;
export const IntegrationPostStatusType = PostStatusType;

/** Extensible, browser-safe identifier for an integration provider family. */
export type IntegrationProviderKey = TIntegrationProviderKey;

/** Direction in which a provider capability exchanges data. */
export type IntegrationCapabilityDirection = TIntegrationCapabilityDirection;

/** Authentication mode declared by a provider's browser-safe manifest. */
export type IntegrationConnectionMode = TIntegrationConnectionMode;

/** A provider capability exposed for registration and dashboard discovery. */
export const IntegrationCapabilityManifest = Schema.Struct({
  configVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  direction: IntegrationCapabilityDirection,
  key: IntegrationCapabilityKey,
});
export interface IntegrationCapabilityManifest extends Schema.Schema.Type<
  typeof IntegrationCapabilityManifest
> {}

/** Browser-safe manifest; credentials and provider configuration never belong here. */
export const IntegrationProviderManifest = Schema.Struct({
  capabilities: Schema.Array(IntegrationCapabilityManifest),
  connectionMode: IntegrationConnectionMode,
  displayName: Schema.NonEmptyString,
  provider: IntegrationProviderKey,
});
export interface IntegrationProviderManifest extends Schema.Schema.Type<
  typeof IntegrationProviderManifest
> {}

/** Canonical V1 facts that outbound routes may subscribe to. */
export type SubscribableIntegrationEventType =
  TSubscribableIntegrationEventType;

/** Synthetic test events traverse delivery but can never be selected by a route. */
export type IntegrationEventType = TIntegrationEventType;
export type IntegrationPostStatusType = typeof IntegrationPostStatusType.Type;

/** Provenance retained with an event to support future loop prevention. */
export const IntegrationEventOrigin = Schema.Struct({
  kind: Schema.Literals(["feeblo", "provider"]),
  provider: Schema.optionalKey(IntegrationProviderKey),
  connectionId: Schema.optionalKey(IntegrationConnectionId.schema),
  routeId: Schema.optionalKey(IntegrationRouteId.schema),
});
export interface IntegrationEventOrigin extends Schema.Schema.Type<
  typeof IntegrationEventOrigin
> {}

/** Immutable provider-neutral envelope persisted before any external request. */
export const IntegrationEventEnvelopeV1 = Schema.Struct({
  causalHopCount: Schema.Int.check(
    Schema.isGreaterThanOrEqualTo(0),
    Schema.isLessThanOrEqualTo(16)
  ),
  causationId: Schema.optionalKey(Schema.NonEmptyString),
  correlationId: Schema.NonEmptyString,
  data: Schema.Json,
  id: IntegrationEventId.schema,
  occurredAt: Schema.DateTimeUtcFromString,
  organizationId: WorkspaceId.schema,
  origin: IntegrationEventOrigin,
  type: IntegrationEventType,
  version: Schema.Literal(1),
});
export interface IntegrationEventEnvelopeV1 extends Schema.Schema.Type<
  typeof IntegrationEventEnvelopeV1
> {}

/** Safe post snapshot used by post-created and post-status-changed envelopes. */
export const IntegrationPostEventData = Schema.Struct({
  actor: Schema.Struct({
    kind: Schema.Literals(["member", "end_user"]),
    memberId: Schema.optionalKey(MemberId.schema),
    displayName: Schema.optionalKey(Schema.String),
  }),
  board: Schema.Struct({
    id: BoardId.schema,
    name: Schema.String,
    slug: Schema.String,
  }),
  post: Schema.Struct({
    id: PostId.schema,
    /** Post body (sanitized markdown) used as the provider issue body; absent for status-change events. */
    description: Schema.optionalKey(Schema.String),
    metadata: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
    status: Schema.Struct({
      id: PostStatusId.schema,
      type: PostStatusType,
    }),
    title: Schema.String,
    url: Schema.URLFromString,
  }),
  previousStatus: Schema.optionalKey(
    Schema.Struct({ id: PostStatusId.schema, type: PostStatusType })
  ),
});
export interface IntegrationPostEventData extends Schema.Schema.Type<
  typeof IntegrationPostEventData
> {}

/** Lifecycle state shared by simple endpoints and future OAuth connections. */
export type IntegrationConnectionLifecycleStatus =
  TIntegrationConnectionLifecycleStatus;

/** Durable delivery lifecycle; a lease is never an external request by itself. */
export type IntegrationDeliveryState = TIntegrationDeliveryState;
export type IntegrationExternalResourceType = TIntegrationExternalResourceType;

/** Immutable route record fields needed for matching and delivery persistence. */
export const IntegrationRoute = Schema.Struct({
  capabilityKey: IntegrationCapabilityKey,
  configVersion: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  connectionId: IntegrationConnectionId.schema,
  enabled: Schema.Boolean,
  eventTypes: IntegrationRouteEventSelection,
  id: IntegrationRouteId.schema,
  provider: IntegrationProviderKey,
  /** Provider-owned versioned configuration; secrets never belong here. */
  providerConfig: Schema.Json,
  safeMetadata: IntegrationSafeDisplayMetadata,
});
export interface IntegrationRoute extends Schema.Schema.Type<
  typeof IntegrationRoute
> {}

/** Connection fields that are safe to persist and return without credentials. */
export const IntegrationConnection = Schema.Struct({
  credentialGeneration: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  id: IntegrationConnectionId.schema,
  lifecycleStatus: IntegrationConnectionLifecycleStatus,
  name: Schema.NonEmptyString,
  organizationId: WorkspaceId.schema,
  provider: IntegrationProviderKey,
  safeMetadata: IntegrationSafeDisplayMetadata,
});
export interface IntegrationConnection extends Schema.Schema.Type<
  typeof IntegrationConnection
> {}

/** Durable delivery record; IDs remain stable through attempts and manual retries. */
export const IntegrationDelivery = Schema.Struct({
  actionKey: Schema.NonEmptyString,
  attemptCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  eventId: IntegrationEventId.schema,
  id: IntegrationDeliveryId.schema,
  leaseExpiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  leaseOwner: Schema.NullOr(Schema.String),
  nextAttemptAt: Schema.DateTimeUtcFromString,
  orderingKey: Schema.NullOr(Schema.String),
  routeId: IntegrationRouteId.schema,
  state: IntegrationDeliveryState,
});
export interface IntegrationDelivery extends Schema.Schema.Type<
  typeof IntegrationDelivery
> {}

/** Append-only safe attempt diagnostics; response bodies and secrets are excluded. */
export const IntegrationDeliveryAttempt = Schema.Struct({
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  deliveryId: IntegrationDeliveryId.schema,
  durationMs: Schema.NullOr(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  errorTag: Schema.NullOr(Schema.String),
  httpStatus: Schema.NullOr(
    Schema.Int.check(Schema.isBetween({ minimum: 100, maximum: 599 }))
  ),
  id: IntegrationDeliveryAttemptId.schema,
  number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
  retryDecision: Schema.NullOr(IntegrationDeliveryRetryDecision),
  startedAt: Schema.DateTimeUtcFromString,
});
export interface IntegrationDeliveryAttempt extends Schema.Schema.Type<
  typeof IntegrationDeliveryAttempt
> {}

/** Persistence failure while atomically recording an event and its matched deliveries. */
export class IntegrationEventRecordingError extends Schema.TaggedError<IntegrationEventRecordingError>()(
  "IntegrationEventRecordingError",
  { message: Schema.String }
) {}

/** Result of transactional event fan-out; zero means no active route matched. */
export interface IntegrationEventRecordingResult {
  readonly deliveryCount: number;
  readonly eventRecorded: boolean;
}

/**
 * Records an immutable event and matching deliveries through the caller's current
 * database transaction; implementations must never make external requests here.
 */
/** Transaction-bound integration event recording capability. */
export interface IntegrationEventRecorderContract {
  readonly recordIntegrationEvent: (input: {
    readonly event: IntegrationEventEnvelopeV1;
  }) => Effect.Effect<
    IntegrationEventRecordingResult,
    IntegrationEventRecordingError
  >;
}

/** Service key for atomic integration event and delivery recording. */
export class IntegrationEventRecorder extends Context.Service<
  IntegrationEventRecorder,
  IntegrationEventRecorderContract
>()("@feeblo/IntegrationEventRecorder") {}

/** Provider-side authentication failure requiring reconnection or remediation. */
export class IntegrationProviderAuthenticationError extends Schema.TaggedError<IntegrationProviderAuthenticationError>()(
  "IntegrationProviderAuthenticationError",
  {
    httpStatus: Schema.optionalKey(Schema.Int),
    message: Schema.String,
    provider: IntegrationProviderKey,
  }
) {}

/** Provider-side rate limiting; retryAfterMs is validated before retry scheduling. */
export class IntegrationProviderRateLimitedError extends Schema.TaggedError<IntegrationProviderRateLimitedError>()(
  "IntegrationProviderRateLimitedError",
  {
    message: Schema.String,
    provider: IntegrationProviderKey,
    httpStatus: Schema.optionalKey(Schema.Int),
    retryAfterMs: Schema.optionalKey(
      Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
    ),
  }
) {}

/** Provider configuration rejected before an outbound request can be made. */
export class IntegrationProviderInvalidConfigurationError extends Schema.TaggedError<IntegrationProviderInvalidConfigurationError>()(
  "IntegrationProviderInvalidConfigurationError",
  {
    httpStatus: Schema.optionalKey(Schema.Int),
    message: Schema.String,
    provider: IntegrationProviderKey,
  }
) {}

/** Retryable provider or transport failure; secrets and raw response bodies stay private. */
export class IntegrationProviderTemporaryFailure extends Schema.TaggedError<IntegrationProviderTemporaryFailure>()(
  "IntegrationProviderTemporaryFailure",
  {
    httpStatus: Schema.optionalKey(Schema.Int),
    message: Schema.String,
    provider: IntegrationProviderKey,
  }
) {}

/** Terminal provider rejection; retrying the same request cannot fix it. */
export class IntegrationProviderPermanentRejection extends Schema.TaggedError<IntegrationProviderPermanentRejection>()(
  "IntegrationProviderPermanentRejection",
  {
    httpStatus: Schema.optionalKey(Schema.Int),
    message: Schema.String,
    provider: IntegrationProviderKey,
  }
) {}

/** Typed failure algebra implemented by every outbound provider handler. */
export type IntegrationProviderDeliveryFailure =
  | IntegrationProviderAuthenticationError
  | IntegrationProviderRateLimitedError
  | IntegrationProviderInvalidConfigurationError
  | IntegrationProviderTemporaryFailure
  | IntegrationProviderPermanentRejection;

/** Provider handler input is canonical data plus safe connection/route references. */
export interface IntegrationProviderDeliveryInput {
  readonly connection: IntegrationConnection;
  readonly delivery: IntegrationDelivery;
  readonly event: IntegrationEventEnvelopeV1;
  readonly route: IntegrationRoute;
}

/**
 * A provider-normalized external resource produced by one successful delivery.
 * Provider credentials and addressing details belong only in safe metadata.
 */
export const IntegrationExternalResourceDraft = Schema.Struct({
  displayKey: Schema.optionalKey(Schema.NonEmptyString),
  /** Feeblo post that owns this external resource link. */
  postId: PostId.schema,
  remoteId: Schema.NonEmptyString,
  stateKey: Schema.optionalKey(Schema.NonEmptyString),
  remoteUrl: Schema.URLFromString,
  resourceType: IntegrationExternalResourceType,
  safeMetadata: IntegrationSafeDisplayMetadata,
  title: Schema.optionalKey(Schema.String),
});
export interface IntegrationExternalResourceDraft extends Schema.Schema.Type<
  typeof IntegrationExternalResourceDraft
> {}

/** Provider handler reports only safe outcome metadata to the delivery kernel. */
export interface IntegrationProviderDeliveryResult {
  /** Resource links to persist with delivery success, guarded by the delivery lease. */
  readonly externalResourceDrafts?: readonly IntegrationExternalResourceDraft[];
  readonly httpStatus?: number;
}

/** One provider implementation for one advertised outbound capability. */
export interface IntegrationCapabilityHandler {
  readonly capabilityKey: TIntegrationCapabilityKey;
  readonly deliver: (
    input: IntegrationProviderDeliveryInput
  ) => Effect.Effect<
    IntegrationProviderDeliveryResult,
    IntegrationProviderDeliveryFailure
  >;
}

/** Raw inbound request handed to a provider capability; the provider owns wire parsing and signature verification. */
export interface IntegrationInboundRequest {
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly rawBody: string;
}

/** Serializable inbound response returned to the external caller. */
export interface IntegrationInboundResponse {
  readonly body: unknown;
  readonly status?: number;
}

/** Terminal rejection of an inbound request after verification failed. */
export class IntegrationInboundRejection extends Schema.TaggedError<IntegrationInboundRejection>()(
  "IntegrationInboundRejection",
  { message: Schema.String, provider: IntegrationProviderKey }
) {}

/** One provider implementation for one advertised inbound capability. */
export interface IntegrationInboundCapabilityHandler {
  readonly capabilityKey: TIntegrationCapabilityKey;
  readonly handle: (
    input: IntegrationInboundRequest
  ) => Effect.Effect<IntegrationInboundResponse, IntegrationInboundRejection>;
}

/** Static provider contribution validated by the server registry during startup. */
export interface IntegrationProviderRegistration {
  readonly connectionConfigurationSchema: Schema.Codec<Schema.Json>;
  readonly handlers: readonly IntegrationCapabilityHandler[];
  readonly inboundHandlers: readonly IntegrationInboundCapabilityHandler[];
  readonly manifest: IntegrationProviderManifest;
  readonly routeConfigurationSchemas: ReadonlyMap<
    string,
    Schema.Codec<Schema.Json>
  >;
}

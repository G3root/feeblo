import {
  IntegrationExternalResourceType,
  IntegrationProviderKey,
  IntegrationSafeDisplayMetadata,
} from "@feeblo/db/validation-schema/integration";
import {
  ExternalResourceCreateRequestId,
  IntegrationConnectionId,
  IntegrationExternalResourceId,
  PostExternalResourceLinkId,
  PostId,
  WorkspaceId,
} from "@feeblo/id";
import { HttpUrl } from "@feeblo/utils/http-url";
import * as Schema from "effect/Schema";

/**
 * Safe linked-resource details rendered on a Feeblo post.
 *
 * The read DTO, so `remoteUrl` stays permissive: a row that predates the
 * `HttpUrl` write restriction (or was written by a path that bypassed it)
 * must still decode, and the dashboard renders a non-http value as text
 * rather than a link. Tightening the read schema would fail the whole
 * `listPostLinks` decode instead of showing that fallback.
 */
export const PostExternalResourceLink = Schema.Struct({
  id: PostExternalResourceLinkId.schema,
  connectionId: IntegrationConnectionId.schema,
  provider: IntegrationProviderKey,
  providerDisplayName: Schema.String,
  resourceType: IntegrationExternalResourceType,
  remoteUrl: Schema.URLFromString,
  displayKey: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  stateKey: Schema.NullOr(Schema.String),
  safeMetadata: IntegrationSafeDisplayMetadata,
});
export type PostExternalResourceLink = Schema.Schema.Type<
  typeof PostExternalResourceLink
>;

/** Authenticated request for every provider resource linked to one post. */
export const PostExternalResourceLinkList = Schema.Struct({
  organizationId: WorkspaceId.schema,
  postId: PostId.schema,
});
export type PostExternalResourceLinkList = Schema.Schema.Type<
  typeof PostExternalResourceLinkList
>;

/** Provider-normalized resource values accepted by the generic persistence capability. */
export const ExternalResourceRecord = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
  resourceType: IntegrationExternalResourceType,
  remoteId: Schema.NonEmptyString,
  remoteUrl: HttpUrl,
  displayKey: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  stateKey: Schema.NullOr(Schema.String),
  safeMetadata: IntegrationSafeDisplayMetadata,
});
export type ExternalResourceRecord = Schema.Schema.Type<
  typeof ExternalResourceRecord
>;

/** Link a normalized provider resource to a Feeblo post. */
export const RecordPostExternalResourceLink = Schema.Struct({
  postId: PostId.schema,
  resource: ExternalResourceRecord,
});
export type RecordPostExternalResourceLink = Schema.Schema.Type<
  typeof RecordPostExternalResourceLink
>;

/** Result from recording a resource and its post link. */
export const RecordedPostExternalResourceLink = Schema.Struct({
  externalResourceId: IntegrationExternalResourceId.schema,
  postExternalResourceLinkId: PostExternalResourceLinkId.schema,
});
export type RecordedPostExternalResourceLink = Schema.Schema.Type<
  typeof RecordedPostExternalResourceLink
>;

export const ExternalResourceCreationReservation = Schema.Struct({
  organizationId: WorkspaceId.schema,
  connectionId: IntegrationConnectionId.schema,
  postId: PostId.schema,
  idempotencyKey: Schema.NonEmptyString,
});
export type ExternalResourceCreationReservation = Schema.Schema.Type<
  typeof ExternalResourceCreationReservation
>;

/**
 * The outcome of asking for a reservation.
 *
 * A taken reservation carries `reservedAt`: the instant that claim was taken,
 * which is also the row's `createdAt`. It is the claim's **fence**. A holder
 * whose lease expired can be re-claimed by another caller, and the re-claim
 * leaves the row `pending`, so `state` cannot tell the two apart — without the
 * fence the expired holder's `completeCreation`/`failCreation` still match and
 * overwrite the new claim's row.
 *
 * The not-taken branch deliberately has no token: a caller that did not take the
 * claim has no claim to end, and the type should not hand it one.
 */
export const ExternalResourceCreationReservationResult = Schema.Union([
  Schema.Struct({
    id: ExternalResourceCreateRequestId.schema,
    reserved: Schema.Literal(true),
    reservedAt: Schema.Date,
    postExternalResourceLinkId: Schema.Null,
  }),
  Schema.Struct({
    id: ExternalResourceCreateRequestId.schema,
    reserved: Schema.Literal(false),
    postExternalResourceLinkId: Schema.NullOr(
      PostExternalResourceLinkId.schema
    ),
  }),
]);
export type ExternalResourceCreationReservationResult = Schema.Schema.Type<
  typeof ExternalResourceCreationReservationResult
>;

export const ExternalResourceCreationCompletion = Schema.Struct({
  requestId: ExternalResourceCreateRequestId.schema,
  /** The claim this completion belongs to; a re-claimed row will not match. */
  reservedAt: Schema.Date,
  externalResourceId: IntegrationExternalResourceId.schema,
  postExternalResourceLinkId: PostExternalResourceLinkId.schema,
});
export type ExternalResourceCreationCompletion = Schema.Schema.Type<
  typeof ExternalResourceCreationCompletion
>;

export const ExternalResourceCreationFailure = Schema.Struct({
  requestId: ExternalResourceCreateRequestId.schema,
  /** The claim this release belongs to; a re-claimed row will not match. */
  reservedAt: Schema.Date,
});
export type ExternalResourceCreationFailure = Schema.Schema.Type<
  typeof ExternalResourceCreationFailure
>;

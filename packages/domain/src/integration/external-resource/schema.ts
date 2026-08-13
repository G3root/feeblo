import {
  IntegrationExternalResourceSafeMetadata,
  IntegrationExternalResourceType,
  IntegrationProviderKey,
} from "@feeblo/db/validation-schema/integration";
import {
  ExternalResourceCreateRequestId,
  IntegrationConnectionId,
  IntegrationExternalResourceId,
  PostExternalResourceLinkId,
  PostId,
  WorkspaceId,
} from "@feeblo/id";
import * as Schema from "effect/Schema";

/** Safe linked-resource details rendered on a Feeblo post. */
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
  safeMetadata: IntegrationExternalResourceSafeMetadata,
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
  remoteUrl: Schema.URLFromString,
  displayKey: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  stateKey: Schema.NullOr(Schema.String),
  safeMetadata: IntegrationExternalResourceSafeMetadata,
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

export const ExternalResourceCreationReservationResult = Schema.Struct({
  id: ExternalResourceCreateRequestId.schema,
  reserved: Schema.Boolean,
  postExternalResourceLinkId: Schema.NullOr(PostExternalResourceLinkId.schema),
});
export type ExternalResourceCreationReservationResult = Schema.Schema.Type<
  typeof ExternalResourceCreationReservationResult
>;

export const ExternalResourceCreationCompletion = Schema.Struct({
  requestId: ExternalResourceCreateRequestId.schema,
  externalResourceId: IntegrationExternalResourceId.schema,
  postExternalResourceLinkId: PostExternalResourceLinkId.schema,
});
export type ExternalResourceCreationCompletion = Schema.Schema.Type<
  typeof ExternalResourceCreationCompletion
>;

export const ExternalResourceCreationFailure = Schema.Struct({
  requestId: ExternalResourceCreateRequestId.schema,
});
export type ExternalResourceCreationFailure = Schema.Schema.Type<
  typeof ExternalResourceCreationFailure
>;

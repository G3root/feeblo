import {
  EmailDeliveryState,
  EmailIntentKind,
  EmailOutboxState,
} from "@feeblo/db/validation-schema/email";
import {
  ChangelogId,
  EmailContactId,
  EmailDeliveryId,
  EmailOutboxId,
  EmailSubscriptionId,
  PostActivityId,
  PostId,
  PostStatusId,
  WorkspaceId,
} from "@feeblo/id";
import * as Schema from "effect/Schema";

// The email-outbox lifecycle vocabularies are canonical in
// `@feeblo/db/validation-schema`; the record structs below embed them so the
// persisted row shapes and their inferred union types stay derived from the
// single source of truth.

// The production Postgres driver and PGlite test driver may return timestamps
// as Date instances or ISO strings respectively. Both decode into Date here.
const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

export const SubmissionCreatedEmailIntentPayload = Schema.Struct({
  kind: Schema.tag("submission.created"),
  postId: PostId.schema,
});

export const ChangelogPublishedEmailIntentPayload = Schema.Struct({
  changelogId: ChangelogId.schema,
  kind: Schema.tag("changelog.published"),
});

export const ChangelogUpdateRequestedEmailIntentPayload = Schema.Struct({
  changelogId: ChangelogId.schema,
  kind: Schema.tag("changelog.update_requested"),
});

export const SubscriptionVerificationRequestedEmailIntentPayload =
  Schema.Struct({
    kind: Schema.tag("subscription.verification_requested"),
    subscriptionId: EmailSubscriptionId.schema,
  });

export const PostOfficialUpdatePublishedEmailIntentPayload = Schema.Struct({
  body: Schema.String,
  kind: Schema.tag("post.official_update_published"),
  postId: PostId.schema,
  updateId: PostActivityId.schema,
});

export const PostStatusChangedEmailIntentPayload = Schema.Struct({
  kind: Schema.tag("post.status_changed"),
  postId: PostId.schema,
  statusId: PostStatusId.schema,
});

export const PostMergedEmailIntentPayload = Schema.Struct({
  kind: Schema.tag("post.merged"),
  postId: PostId.schema,
  targetPostId: PostId.schema,
});

export const PostClosedEmailIntentPayload = Schema.Struct({
  kind: Schema.tag("post.closed"),
  postId: PostId.schema,
});

/**
 * Version-one discriminated payloads persisted in `email_outbox.payload`.
 * Later template/rendering data is snapshotted in `email_delivery` instead.
 */
export const EmailIntentPayload = Schema.Union([
  SubmissionCreatedEmailIntentPayload,
  ChangelogPublishedEmailIntentPayload,
  ChangelogUpdateRequestedEmailIntentPayload,
  SubscriptionVerificationRequestedEmailIntentPayload,
  PostStatusChangedEmailIntentPayload,
  PostOfficialUpdatePublishedEmailIntentPayload,
  PostMergedEmailIntentPayload,
  PostClosedEmailIntentPayload,
]).pipe(Schema.toTaggedUnion("kind"));

export type EmailIntentPayload = Schema.Schema.Type<typeof EmailIntentPayload>;

export const EmailUnsubscribeTarget = Schema.Union([
  Schema.Struct({
    kind: Schema.tag("subscription"),
    subscriptionId: EmailSubscriptionId.schema,
  }),
  Schema.Struct({
    kind: Schema.tag("settings"),
    url: Schema.String,
  }),
]).pipe(Schema.toTaggedUnion("kind"));

/** Immutable provider-neutral renderer input without a persisted bearer token. */
export const NotificationTemplatePayload = Schema.Struct({
  actionLabel: Schema.String,
  actionUrl: Schema.String,
  body: Schema.String,
  eyebrow: Schema.String,
  posts: Schema.Array(
    Schema.Struct({
      label: Schema.String,
      url: Schema.String,
    })
  ),
  title: Schema.String,
  unsubscribe: EmailUnsubscribeTarget,
});

export type NotificationTemplatePayload = Schema.Schema.Type<
  typeof NotificationTemplatePayload
>;

/** Immutable renderer input for the dedicated changelog email. */
export const ChangelogTemplatePayload = Schema.Struct({
  actionLabel: Schema.String,
  actionUrl: Schema.String,
  body: Schema.String,
  categories: Schema.optional(Schema.Array(Schema.String)),
  coverImageUrl: Schema.optional(Schema.NullOr(Schema.String)),
  eyebrow: Schema.String,
  organizationName: Schema.optional(Schema.NullOr(Schema.String)),
  publishedAtLabel: Schema.optional(Schema.NullOr(Schema.String)),
  title: Schema.String,
  unsubscribe: EmailUnsubscribeTarget,
});

export type ChangelogTemplatePayload = Schema.Schema.Type<
  typeof ChangelogTemplatePayload
>;

/** Stored payload for one double-opt-in verification email. */
export const SubscriptionVerificationTemplatePayload = Schema.Struct({
  subscriptionId: EmailSubscriptionId.schema,
});

export const EmailOutboxRecord = Schema.Struct({
  aggregateId: Schema.String,
  aggregateType: Schema.String,
  createdAt: PersistedDate,
  deduplicationKey: Schema.String,
  expiresAt: Schema.NullOr(PersistedDate),
  id: EmailOutboxId.schema,
  kind: EmailIntentKind,
  organizationId: WorkspaceId.schema,
  payload: EmailIntentPayload,
  scheduledAt: PersistedDate,
  state: EmailOutboxState,
  updatedAt: PersistedDate,
});

export type EmailOutboxRecord = Schema.Schema.Type<typeof EmailOutboxRecord>;

export const EmailDeliveryRecord = Schema.Struct({
  acceptedAt: Schema.NullOr(PersistedDate),
  attemptCount: Schema.Number,
  contactId: Schema.NullOr(EmailContactId.schema),
  createdAt: PersistedDate,
  deliveredAt: Schema.NullOr(PersistedDate),
  id: EmailDeliveryId.schema,
  lastError: Schema.Unknown,
  messageId: Schema.String,
  nextAttemptAt: Schema.NullOr(PersistedDate),
  outboxId: EmailOutboxId.schema,
  providerMetadata: Schema.Unknown,
  recipientEmail: Schema.String,
  state: EmailDeliveryState,
  template: Schema.String,
  templatePayload: Schema.Unknown,
  templateVersion: Schema.Number,
  updatedAt: PersistedDate,
});

export type EmailDeliveryRecord = Schema.Schema.Type<
  typeof EmailDeliveryRecord
>;

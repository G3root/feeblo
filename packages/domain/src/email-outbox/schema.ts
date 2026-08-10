import {
  EmailDeliveryState,
  EmailIntentKind,
  EmailOutboxState,
} from "@feeblo/db/validation-schema/email";
import * as Schema from "effect/Schema";

// The email-outbox lifecycle vocabularies are canonical in
// `@feeblo/db/validation-schema`; the record structs below embed them so the
// persisted row shapes and their inferred union types stay derived from the
// single source of truth.

// The production Postgres driver and PGlite test driver may return timestamps
// as Date instances or ISO strings respectively. Both decode into Date here.
const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

export const SubmissionCreatedEmailIntentPayload = Schema.Struct({
  kind: Schema.Literal("submission.created"),
  postId: Schema.String,
});

export const ChangelogPublishedEmailIntentPayload = Schema.Struct({
  changelogId: Schema.String,
  kind: Schema.Literal("changelog.published"),
});

export const ChangelogUpdateRequestedEmailIntentPayload = Schema.Struct({
  changelogId: Schema.String,
  kind: Schema.Literal("changelog.update_requested"),
});

export const PostStatusChangedEmailIntentPayload = Schema.Struct({
  kind: Schema.Literal("post.status_changed"),
  postId: Schema.String,
  statusId: Schema.String,
});

export const PostMergedEmailIntentPayload = Schema.Struct({
  kind: Schema.Literal("post.merged"),
  postId: Schema.String,
  targetPostId: Schema.String,
});

export const PostClosedEmailIntentPayload = Schema.Struct({
  kind: Schema.Literal("post.closed"),
  postId: Schema.String,
});

/**
 * Version-one discriminated payloads persisted in `email_outbox.payload`.
 * Later template/rendering data is snapshotted in `email_delivery` instead.
 */
export const EmailIntentPayload = Schema.Union([
  SubmissionCreatedEmailIntentPayload,
  ChangelogPublishedEmailIntentPayload,
  ChangelogUpdateRequestedEmailIntentPayload,
  PostStatusChangedEmailIntentPayload,
  PostMergedEmailIntentPayload,
  PostClosedEmailIntentPayload,
]);

export type EmailIntentPayload = Schema.Schema.Type<typeof EmailIntentPayload>;

/** Immutable, provider-neutral renderer input for version one notifications. */
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
  unsubscribeUrl: Schema.String,
});

export type NotificationTemplatePayload = Schema.Schema.Type<
  typeof NotificationTemplatePayload
>;

/** Backwards-compatible name for the original submission-only template. */
export const SubmissionNotificationTemplatePayload =
  NotificationTemplatePayload;

export type SubmissionNotificationTemplatePayload = Schema.Schema.Type<
  typeof SubmissionNotificationTemplatePayload
>;

export const EmailOutboxRecord = Schema.Struct({
  aggregateId: Schema.String,
  aggregateType: Schema.String,
  createdAt: PersistedDate,
  deduplicationKey: Schema.String,
  expiresAt: Schema.NullOr(PersistedDate),
  id: Schema.String,
  kind: EmailIntentKind,
  organizationId: Schema.String,
  payload: EmailIntentPayload,
  scheduledAt: PersistedDate,
  state: EmailOutboxState,
  updatedAt: PersistedDate,
});

export type EmailOutboxRecord = Schema.Schema.Type<typeof EmailOutboxRecord>;

export const EmailDeliveryRecord = Schema.Struct({
  acceptedAt: Schema.NullOr(PersistedDate),
  attemptCount: Schema.Number,
  contactId: Schema.NullOr(Schema.String),
  createdAt: PersistedDate,
  deliveredAt: Schema.NullOr(PersistedDate),
  id: Schema.String,
  lastError: Schema.Unknown,
  messageId: Schema.String,
  nextAttemptAt: Schema.NullOr(PersistedDate),
  outboxId: Schema.String,
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

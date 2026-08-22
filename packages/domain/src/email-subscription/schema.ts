import {
  EmailContactVerificationState,
  EmailSubscriptionSource,
  EmailSubscriptionState,
  EmailSuppressionReason,
} from "@feeblo/db/validation-schema/email";
import {
  EmailContactId,
  EmailSubscriptionId,
  PostId,
  UserId,
  WorkspaceId,
} from "@feeblo/id";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

// The email-subscription vocabularies are canonical in
// `@feeblo/db/validation-schema`; the record structs below embed them so the
// persisted row shapes and their inferred union types stay derived from the
// single source of truth.

const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

const EmailAddressValue = Schema.String.pipe(
  Schema.check(Schema.isMinLength(3)),
  Schema.check(Schema.isMaxLength(320)),
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
);

/** A normalized email address suitable for persistence and equality checks. */
export const EmailAddress = EmailAddressValue;

export type EmailAddress = Schema.Schema.Type<typeof EmailAddress>;

export class EmailSubscriptionInputError extends Schema.TaggedError<EmailSubscriptionInputError>()(
  "EmailSubscriptionInputError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export class EmailSubscriptionDataError extends Schema.TaggedError<EmailSubscriptionDataError>()(
  "EmailSubscriptionDataError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export const parseEmailAddress = (
  input: string,
  operation: string
): Effect.Effect<EmailAddress, EmailSubscriptionInputError> =>
  Schema.decodeUnknownEffect(EmailAddress)(input.trim().toLowerCase()).pipe(
    Effect.mapError(
      () =>
        new EmailSubscriptionInputError({
          operation,
          reason: "Email address is invalid",
        })
    )
  );

export const EmailSubscriptionTopic = Schema.Union([
  Schema.Struct({
    topicId: Schema.Null,
    topicType: Schema.tag("submission"),
  }),
  Schema.Struct({
    topicId: Schema.Null,
    topicType: Schema.tag("changelog"),
  }),
  Schema.Struct({
    topicId: PostId.schema,
    topicType: Schema.tag("post"),
  }),
]).pipe(Schema.toTaggedUnion("topicType"));

export type EmailSubscriptionTopic = Schema.Schema.Type<
  typeof EmailSubscriptionTopic
>;

export const EmailContactRecord = Schema.Struct({
  createdAt: PersistedDate,
  email: EmailAddress,
  id: EmailContactId.schema,
  organizationId: WorkspaceId.schema,
  updatedAt: PersistedDate,
  userId: Schema.NullOr(UserId.schema),
  verificationState: EmailContactVerificationState,
  verifiedAt: Schema.NullOr(PersistedDate),
});

export type EmailContactRecord = Schema.Schema.Type<typeof EmailContactRecord>;

export const EmailSubscriptionRecord = Schema.Struct({
  contactId: EmailContactId.schema,
  createdAt: PersistedDate,
  id: EmailSubscriptionId.schema,
  organizationId: WorkspaceId.schema,
  source: EmailSubscriptionSource,
  state: EmailSubscriptionState,
  topicId: Schema.NullOr(PostId.schema),
  topicType: Schema.Literals(["submission", "changelog", "post"]),
  unsubscribedAt: Schema.NullOr(PersistedDate),
  updatedAt: PersistedDate,
  verificationExpiresAt: Schema.NullOr(PersistedDate),
  verifiedAt: Schema.NullOr(PersistedDate),
});

export type EmailSubscriptionRecord = Schema.Schema.Type<
  typeof EmailSubscriptionRecord
>;

export const EmailSuppressionRecord = Schema.Struct({
  createdAt: PersistedDate,
  email: EmailAddress,
  providerEventId: Schema.NullOr(Schema.String),
  reason: EmailSuppressionReason,
});

export type EmailSuppressionRecord = Schema.Schema.Type<
  typeof EmailSuppressionRecord
>;

/** Public request to manually subscribe an address to one workspace changelog. */
export const ChangelogSubscriptionRequest = Schema.Struct({
  email: EmailAddress,
  organizationId: WorkspaceId.schema,
});

export type ChangelogSubscriptionRequest = Schema.Schema.Type<
  typeof ChangelogSubscriptionRequest
>;

/** Authenticated status lookup for the current user's changelog subscription. */
export const ChangelogSubscriptionStatusRequest = Schema.Struct({
  organizationId: WorkspaceId.schema,
});

export type ChangelogSubscriptionStatusRequest = Schema.Schema.Type<
  typeof ChangelogSubscriptionStatusRequest
>;

/** Authenticated toggle for the current user's changelog subscription. */
export const ChangelogSubscriptionSetRequest = Schema.Struct({
  organizationId: WorkspaceId.schema,
  subscribed: Schema.Boolean,
});

export type ChangelogSubscriptionSetRequest = Schema.Schema.Type<
  typeof ChangelogSubscriptionSetRequest
>;

export const ChangelogSubscriptionStateAccepted = Schema.Struct({
  subscribed: Schema.Boolean,
});

/** Opaque token supplied by a public verification or unsubscribe link. */
export const EmailSubscriptionTokenRequest = Schema.Struct({
  token: Schema.String.pipe(
    Schema.check(Schema.isMinLength(1)),
    Schema.check(Schema.isMaxLength(512))
  ),
});

export type EmailSubscriptionTokenRequest = Schema.Schema.Type<
  typeof EmailSubscriptionTokenRequest
>;

/** Deliberately token-free public acknowledgement for a consent request. */
export const EmailSubscriptionRequestAccepted = Schema.Struct({
  verificationRequired: Schema.Boolean,
});

export const EmailSubscriptionVerificationAccepted = Schema.Struct({
  verified: Schema.Boolean,
});

export const EmailSubscriptionUnsubscribeAccepted = Schema.Struct({
  unsubscribed: Schema.Boolean,
});

/** Authenticated administrator preference for submission notification email. */
export const SubmissionNotificationPreferenceRequest = Schema.Struct({
  enabled: Schema.Boolean,
  organizationId: WorkspaceId.schema,
});

export type SubmissionNotificationPreferenceRequest = Schema.Schema.Type<
  typeof SubmissionNotificationPreferenceRequest
>;

export const SubmissionNotificationPreferenceAccepted = Schema.Struct({
  enabled: Schema.Boolean,
});

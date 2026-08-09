import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { WorkspaceId } from "@feeblo/id";

const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

const EmailAddressValue = Schema.String.pipe(
  Schema.check(Schema.isMinLength(3)),
  Schema.check(Schema.isMaxLength(320)),
  Schema.check(Schema.isPattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
);

/** A normalized email address suitable for persistence and equality checks. */
export const EmailAddress = EmailAddressValue;

export type EmailAddress = Schema.Schema.Type<typeof EmailAddress>;

export class EmailSubscriptionInputError extends Schema.TaggedErrorClass<EmailSubscriptionInputError>()(
  "EmailSubscriptionInputError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export class EmailSubscriptionDataError extends Schema.TaggedErrorClass<EmailSubscriptionDataError>()(
  "EmailSubscriptionDataError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export const normalizeEmailAddress = (
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
    topicType: Schema.Literal("changelog"),
  }),
  Schema.Struct({
    topicId: Schema.String.pipe(Schema.check(Schema.isMinLength(1))),
    topicType: Schema.Literal("post"),
  }),
]);

export type EmailSubscriptionTopic = Schema.Schema.Type<
  typeof EmailSubscriptionTopic
>;

export const EmailSubscriptionState = Schema.Literals([
  "pending_verification",
  "active",
  "paused_by_plan",
  "unsubscribed",
]);

export type EmailSubscriptionState = Schema.Schema.Type<
  typeof EmailSubscriptionState
>;

export const EmailSubscriptionSource = Schema.Literals([
  "explicit",
  "post_creator",
]);

export type EmailSubscriptionSource = Schema.Schema.Type<
  typeof EmailSubscriptionSource
>;

export const EmailSuppressionReason = Schema.Literals([
  "hard_bounce",
  "complaint",
  "administrative_block",
]);

export type EmailSuppressionReason = Schema.Schema.Type<
  typeof EmailSuppressionReason
>;

export const EmailContactRecord = Schema.Struct({
  createdAt: PersistedDate,
  email: EmailAddress,
  id: Schema.String,
  organizationId: Schema.String,
  updatedAt: PersistedDate,
  userId: Schema.NullOr(Schema.String),
  verificationState: Schema.Literals(["pending", "verified"]),
  verifiedAt: Schema.NullOr(PersistedDate),
});

export type EmailContactRecord = Schema.Schema.Type<typeof EmailContactRecord>;

export const EmailSubscriptionRecord = Schema.Struct({
  contactId: Schema.String,
  createdAt: PersistedDate,
  id: Schema.String,
  organizationId: Schema.String,
  source: EmailSubscriptionSource,
  state: EmailSubscriptionState,
  topicId: Schema.NullOr(Schema.String),
  topicType: Schema.Literals(["changelog", "post"]),
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

import * as Schema from "effect/Schema";

const PersistedDate = Schema.Union([Schema.Date, Schema.DateFromString]);

const ProviderIdentifier = Schema.String.pipe(
  Schema.check(Schema.isMinLength(1)),
  Schema.check(Schema.isMaxLength(256))
);

const SafeProviderMetadata = Schema.Struct({
  category: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))
  ),
  reasonCode: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(128)))
  ),
});

const LifecycleEventFields = {
  eventId: ProviderIdentifier,
  messageId: ProviderIdentifier,
  metadata: Schema.optionalKey(SafeProviderMetadata),
  occurredAt: PersistedDate,
};

export const ProviderLifecycleEvent = Schema.Union([
  Schema.Struct({
    ...LifecycleEventFields,
    type: Schema.tag("delivered"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    type: Schema.tag("deferred"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    bounceType: Schema.Literals(["hard", "soft"]),
    type: Schema.tag("bounced"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    type: Schema.tag("failed"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    type: Schema.tag("complained"),
  }),
]).pipe(Schema.toTaggedUnion("type"));

export type ProviderLifecycleEvent = Schema.Schema.Type<
  typeof ProviderLifecycleEvent
>;

export class EmailProviderFeedbackInputError extends Schema.TaggedError<EmailProviderFeedbackInputError>()(
  "EmailProviderFeedbackInputError",
  {
    message: Schema.String,
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export class EmailProviderFeedbackDataError extends Schema.TaggedError<EmailProviderFeedbackDataError>()(
  "EmailProviderFeedbackDataError",
  {
    cause: Schema.optionalKey(Schema.Defect()),
    message: Schema.String,
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

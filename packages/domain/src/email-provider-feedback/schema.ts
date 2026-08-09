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
    type: Schema.Literal("delivered"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    type: Schema.Literal("deferred"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    bounceType: Schema.Literals(["hard", "soft"]),
    type: Schema.Literal("bounced"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    type: Schema.Literal("failed"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    type: Schema.Literal("complained"),
  }),
]);

export type ProviderLifecycleEvent = Schema.Schema.Type<
  typeof ProviderLifecycleEvent
>;

export class EmailProviderFeedbackInputError extends Schema.TaggedErrorClass<EmailProviderFeedbackInputError>()(
  "EmailProviderFeedbackInputError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

export class EmailProviderFeedbackDataError extends Schema.TaggedErrorClass<EmailProviderFeedbackDataError>()(
  "EmailProviderFeedbackDataError",
  {
    operation: Schema.String,
    reason: Schema.String,
  }
) {}

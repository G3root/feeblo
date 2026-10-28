import { EmailAddress } from "@feeblo/domain-contracts/email";
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
  /**
   * The `X-Feeblo-Delivery-Id` header the outbox stamps on every message.
   * Present because Message-ID is not always echoed back in a form we can
   * match, and a hard bounce that cannot be correlated can still be
   * suppressed when its recipient is known.
   */
  deliveryId: Schema.optionalKey(ProviderIdentifier),
  metadata: Schema.optionalKey(SafeProviderMetadata),
  occurredAt: PersistedDate,
  /**
   * The addresses the provider reported for this event. A bounce or complaint
   * names the recipient; `mail.destination` is the fallback. Suppression uses
   * this list, which is why it is required even when the delivery row is
   * found: a provider event can name an address different from the delivery's
   * (a forwarded message, an envelope rewrite), and the reported address is
   * the one that failed.
   */
  recipients: Schema.Array(EmailAddress),
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
    /**
     * `undetermined` is AWS's "SES could not classify this bounce". It is not
     * a permanent address fact, so it is retried like a soft bounce and never
     * suppresses on its own.
     */
    bounceType: Schema.Literals(["hard", "soft", "undetermined"]),
    type: Schema.tag("bounced"),
  }),
  Schema.Struct({
    ...LifecycleEventFields,
    /**
     * Proves the provider never took the message. `ses-mapping.ts` maps
     * SES's `Reject` here — a message the provider rejected instead of
     * accepting — so a delivery row this event touches must never start
     * counting as an accepted send. Everything that happened after an
     * accepted send is carried by the other types.
     */
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

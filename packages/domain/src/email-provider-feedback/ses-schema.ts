import * as Schema from "effect/Schema";

const OptionalString = Schema.optionalKey(Schema.String);

export const SesSnsSubscriptionConfirmation = Schema.Struct({
  Type: Schema.tag("SubscriptionConfirmation"),
  MessageId: Schema.String,
  Token: OptionalString,
  TopicArn: OptionalString,
  Message: OptionalString,
  SubscribeURL: OptionalString,
  Timestamp: OptionalString,
  SignatureVersion: OptionalString,
  Signature: OptionalString,
  SigningCertURL: OptionalString,
  UnsubscribeURL: OptionalString,
});

export interface SesSnsSubscriptionConfirmation extends Schema.Schema.Type<
  typeof SesSnsSubscriptionConfirmation
> {}

export const SesSnsUnsubscribeConfirmation = Schema.Struct({
  Type: Schema.tag("UnsubscribeConfirmation"),
  MessageId: Schema.String,
  Token: OptionalString,
  TopicArn: OptionalString,
  Message: OptionalString,
  SubscribeURL: OptionalString,
  Timestamp: OptionalString,
  SignatureVersion: OptionalString,
  Signature: OptionalString,
  SigningCertURL: OptionalString,
  UnsubscribeURL: OptionalString,
});

export interface SesSnsUnsubscribeConfirmation extends Schema.Schema.Type<
  typeof SesSnsUnsubscribeConfirmation
> {}

export const SesSnsNotification = Schema.Struct({
  Type: Schema.tag("Notification"),
  MessageId: Schema.String,
  TopicArn: OptionalString,
  Message: Schema.String,
  Subject: OptionalString,
  Timestamp: OptionalString,
  SignatureVersion: OptionalString,
  Signature: OptionalString,
  SigningCertURL: OptionalString,
});

export interface SesSnsNotification extends Schema.Schema.Type<
  typeof SesSnsNotification
> {}

export const SesSnsEnvelope = Schema.Union([
  SesSnsSubscriptionConfirmation,
  SesSnsUnsubscribeConfirmation,
  SesSnsNotification,
]).pipe(Schema.toTaggedUnion("Type"));

export type SesSnsEnvelope = Schema.Schema.Type<typeof SesSnsEnvelope>;

const SesMailHeader = Schema.Struct({
  name: Schema.String,
  value: Schema.String,
});

const SesMailCommonHeaders = Schema.Struct({
  messageId: OptionalString,
});

/** Carrier fields of the `mail` object shared by every SES event notification. */
export const SesMail = Schema.Struct({
  timestamp: Schema.String,
  messageId: Schema.String,
  source: OptionalString,
  destination: Schema.optionalKey(Schema.Array(Schema.String)),
  headers: Schema.optionalKey(Schema.Array(SesMailHeader)),
  commonHeaders: Schema.optionalKey(SesMailCommonHeaders),
});

export interface SesMail extends Schema.Schema.Type<typeof SesMail> {}

const SesBouncedRecipient = Schema.Struct({
  // AWS omits emailAddress when the address is on the account suppression list.
  emailAddress: OptionalString,
  action: OptionalString,
  status: OptionalString,
  diagnosticCode: OptionalString,
});

export const SesBounce = Schema.Struct({
  bounceType: Schema.Literals(["Permanent", "Transient", "Undetermined"]),
  bounceSubType: OptionalString,
  reportingMTA: OptionalString,
  feedbackId: OptionalString,
  timestamp: OptionalString,
  bouncedRecipients: Schema.optionalKey(Schema.Array(SesBouncedRecipient)),
});

export interface SesBounce extends Schema.Schema.Type<typeof SesBounce> {}

export const SesComplaint = Schema.Struct({
  timestamp: OptionalString,
  feedbackId: OptionalString,
  complaintFeedbackType: OptionalString,
  complainedRecipients: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        // AWS omits emailAddress when the address is on the account suppression list.
        emailAddress: OptionalString,
      })
    )
  ),
});

export interface SesComplaint extends Schema.Schema.Type<typeof SesComplaint> {}

export const SesDelivery = Schema.Struct({
  timestamp: OptionalString,
  processingTimeMillis: Schema.optionalKey(Schema.Number),
  recipients: Schema.optionalKey(Schema.Array(Schema.String)),
  smtpResponse: OptionalString,
  reportingMTA: OptionalString,
});

export interface SesDelivery extends Schema.Schema.Type<typeof SesDelivery> {}

export const SesDeliveryDelay = Schema.Struct({
  delayType: OptionalString,
  smtpResponse: OptionalString,
  reportingMTA: OptionalString,
  timestamp: OptionalString,
});

export interface SesDeliveryDelay extends Schema.Schema.Type<
  typeof SesDeliveryDelay
> {}

export const SesReject = Schema.Struct({
  reason: OptionalString,
});

export interface SesReject extends Schema.Schema.Type<typeof SesReject> {}

const SesReceivedEventTypes = Schema.Literals([
  "Send",
  "Delivery",
  "DeliveryDelay",
  "Bounce",
  "Complaint",
  "Reject",
  "Open",
  "Click",
  // AWS spells the template-rendering failure event with uppercase letters.
  "Rendering Failure",
  // Published when a recipient subscribes or unsubscribes via SES contact lists.
  "Subscription",
]);

export const SesEventNotification = Schema.Struct({
  eventType: SesReceivedEventTypes,
  mail: SesMail,
  bounce: Schema.optionalKey(SesBounce),
  complaint: Schema.optionalKey(SesComplaint),
  delivery: Schema.optionalKey(SesDelivery),
  deliveryDelay: Schema.optionalKey(SesDeliveryDelay),
  reject: Schema.optionalKey(SesReject),
});

export interface SesEventNotification extends Schema.Schema.Type<
  typeof SesEventNotification
> {}

import * as Schema from "effect/Schema";

/** Typed failure produced when a webhook endpoint violates outbound security policy. */
export class WebhookEndpointSecurityError extends Schema.TaggedErrorClass<WebhookEndpointSecurityError>()(
  "WebhookEndpointSecurityError",
  { reason: Schema.String }
) {}

/** Typed failure produced when encrypted webhook credentials cannot be processed. */
export class WebhookCredentialEncryptionError extends Schema.TaggedErrorClass<WebhookCredentialEncryptionError>()(
  "WebhookCredentialEncryptionError",
  { operation: Schema.Literals(["encrypt", "decrypt"]), reason: Schema.String }
) {}

/** Typed failure produced when signing-key generation or Standard Webhooks signing fails. */
export class WebhookSigningError extends Schema.TaggedErrorClass<WebhookSigningError>()(
  "WebhookSigningError",
  { operation: Schema.Literals(["generate", "sign"]) }
) {}

/** Typed transport failure that records no endpoint, secret, response body, or raw payload. */
export class WebhookTransportError extends Schema.TaggedErrorClass<WebhookTransportError>()(
  "WebhookTransportError",
  {
    kind: Schema.Literals([
      "timeout",
      "network",
      "redirect",
      "payload_too_large",
    ]),
    status: Schema.optionalKey(Schema.Number),
  }
) {}

import * as Schema from "effect/Schema";

/** Typed failure produced when a webhook endpoint violates outbound security policy. */
export class WebhookEndpointSecurityError extends Schema.TaggedError<WebhookEndpointSecurityError>()(
  "WebhookEndpointSecurityError",
  { reason: Schema.String }
) {}

/** Typed failure produced when encrypted webhook credentials cannot be processed. */
export class WebhookCredentialEncryptionError extends Schema.TaggedError<WebhookCredentialEncryptionError>()(
  "WebhookCredentialEncryptionError",
  { operation: Schema.Literals(["encrypt", "decrypt"]), reason: Schema.String }
) {}

/** Typed failure produced when signing-key generation or Standard Webhooks signing fails. */
export class WebhookSigningError extends Schema.TaggedError<WebhookSigningError>()(
  "WebhookSigningError",
  { operation: Schema.Literals(["generate", "sign"]) }
) {}

/**
 * Typed transport failure that records no endpoint, secret, response body, or raw payload.
 * The underlying client error cause is intentionally dropped: it can carry the endpoint URL
 * and request metadata that must stay out of persisted and logged failures.
 */
export class WebhookTransportError extends Schema.TaggedError<WebhookTransportError>()(
  "WebhookTransportError",
  {
    kind: Schema.Literals(["timeout", "network", "payload_too_large"]),
    message: Schema.String,
  }
) {}

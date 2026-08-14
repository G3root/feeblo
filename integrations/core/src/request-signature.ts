import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

/** Failure verifying a provider request signature (freshness window, scheme, or cryptographic match). */
export class IntegrationRequestSignatureError extends Schema.TaggedError<IntegrationRequestSignatureError>()(
  "IntegrationRequestSignatureError",
  { reason: Schema.String }
) {}

/**
 * Shared request-signature scaffolding used by the Slack (HMAC-SHA256) and
 * Discord (Ed25519) providers: parses the request timestamp header, enforces
 * the freshness window, then delegates the provider-specific cryptographic
 * check. Providers own their wire format and crypto primitive; this owns the
 * common "was this request forged or replayed" window.
 */
export const verifyRequestSignature = ({
  maxAgeMs,
  now = Date.now(),
  signatureHeader,
  timestampHeader,
  verify,
}: {
  readonly maxAgeMs: number;
  readonly now?: number;
  readonly signatureHeader: string | undefined;
  readonly timestampHeader: string | undefined;
  readonly verify: (input: {
    readonly signatureHeader: string;
    readonly timestampHeader: string;
  }) => Effect.Effect<void, IntegrationRequestSignatureError>;
}): Effect.Effect<void, IntegrationRequestSignatureError> => {
  if (timestampHeader === undefined || signatureHeader === undefined) {
    return Effect.fail(
      new IntegrationRequestSignatureError({
        reason: "Request signature headers are missing",
      })
    );
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return Effect.fail(
      new IntegrationRequestSignatureError({
        reason: "Request timestamp is invalid",
      })
    );
  }
  if (Math.abs(now - timestamp * 1000) > maxAgeMs) {
    return Effect.fail(
      new IntegrationRequestSignatureError({
        reason: "Request timestamp is stale",
      })
    );
  }
  return verify({ signatureHeader, timestampHeader });
};

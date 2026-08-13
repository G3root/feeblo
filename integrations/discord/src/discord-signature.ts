import { createPublicKey, verify } from "node:crypto";
import {
  IntegrationRequestSignatureError,
  verifyRequestSignature,
} from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import type { DiscordSignatureVerificationError } from "./discord-errors";

/** Maximum age of a Discord request before its signature is rejected (Discord recommends a small replay window). */
export const DISCORD_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/** DER SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key (Discord ships the key as 64 hex chars). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

const DISCORD_SIGNATURE_PATTERN = /^[0-9a-f]{128}$/;

/**
 * Verifies a Discord interaction request signature (`x-signature-ed25519`
 * over `x-signature-timestamp + rawBody`) against the application public key
 * and rejects requests older than the freshness window. Returns the verified
 * timestamp on success.
 */
export const verifyDiscordRequestSignature = ({
  rawBody,
  publicKey,
  timestampHeader,
  signatureHeader,
  now = Date.now(),
}: {
  readonly rawBody: string;
  readonly publicKey: string;
  readonly timestampHeader: string | undefined;
  readonly signatureHeader: string | undefined;
  readonly now?: number;
}): Effect.Effect<void, DiscordSignatureVerificationError> =>
  verifyRequestSignature({
    maxAgeMs: DISCORD_SIGNATURE_MAX_AGE_MS,
    now,
    signatureHeader,
    timestampHeader,
    verify: ({ signatureHeader, timestampHeader }) => {
      // Discord signs with Ed25519; the header is always 64 bytes of hex.
      if (!DISCORD_SIGNATURE_PATTERN.test(signatureHeader)) {
        return Effect.fail(
          new IntegrationRequestSignatureError({
            reason: "Discord signature is invalid",
          })
        );
      }
      let key: ReturnType<typeof createPublicKey>;
      try {
        key = createPublicKey({
          key: Buffer.concat([
            ED25519_SPKI_PREFIX,
            Buffer.from(publicKey, "hex"),
          ]),
          format: "der",
          type: "spki",
        });
      } catch {
        return Effect.fail(
          new IntegrationRequestSignatureError({
            reason: "Discord public key is invalid",
          })
        );
      }
      const valid = verify(
        null,
        Buffer.from(`${timestampHeader}${rawBody}`),
        key,
        Buffer.from(signatureHeader, "hex")
      );
      if (!valid) {
        return Effect.fail(
          new IntegrationRequestSignatureError({
            reason: "Discord signature does not match",
          })
        );
      }
      return Effect.void;
    },
  });

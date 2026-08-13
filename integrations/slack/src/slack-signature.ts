import { createHmac, timingSafeEqual } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { SlackSignatureVerificationError } from "./slack-errors";

/** Maximum age of a Slack request before its signature is rejected (Slack recommends 5 minutes). */
export const SLACK_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * Verifies a Slack request signature (`x-slack-signature` over
 * `v0:{timestamp}:{rawBody}`) and rejects requests older than the freshness
 * window. Returns the verified timestamp on success.
 */
export const verifySlackRequestSignature = ({
  rawBody,
  signingSecret,
  timestampHeader,
  signatureHeader,
  now = Date.now(),
}: {
  readonly rawBody: string;
  readonly signingSecret: Redacted.Redacted<string>;
  readonly timestampHeader: string | undefined;
  readonly signatureHeader: string | undefined;
  readonly now?: number;
}): Effect.Effect<void, SlackSignatureVerificationError> => {
  if (timestampHeader === undefined || signatureHeader === undefined) {
    return Effect.fail(
      new SlackSignatureVerificationError({
        reason: "Slack signature headers are missing",
      })
    );
  }
  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    return Effect.fail(
      new SlackSignatureVerificationError({
        reason: "Slack request timestamp is invalid",
      })
    );
  }
  if (Math.abs(now - timestamp * 1000) > SLACK_SIGNATURE_MAX_AGE_MS) {
    return Effect.fail(
      new SlackSignatureVerificationError({
        reason: "Slack request timestamp is stale",
      })
    );
  }
  if (!signatureHeader.startsWith("v0=")) {
    return Effect.fail(
      new SlackSignatureVerificationError({
        reason: "Slack signature scheme is invalid",
      })
    );
  }
  const expected = createHmac("sha256", Redacted.value(signingSecret))
    .update(`v0:${timestampHeader}:${rawBody}`)
    .digest("hex");
  const received = signatureHeader.slice("v0=".length);
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return Effect.fail(
      new SlackSignatureVerificationError({
        reason: "Slack signature does not match",
      })
    );
  }
  return Effect.void;
};

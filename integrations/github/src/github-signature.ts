import { createHmac, timingSafeEqual } from "node:crypto";
import { IntegrationRequestSignatureError } from "@feeblo/integration-core";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import type { GitHubSignatureVerificationError } from "./github-errors";

/** Verifies GitHub's X-Hub-Signature-256 against the exact raw UTF-8 body. */
export const verifyGitHubWebhookSignature = ({
  rawBody,
  signatureHeader,
  webhookSecret,
}: {
  readonly rawBody: string;
  readonly signatureHeader: string | undefined;
  readonly webhookSecret: Redacted.Redacted<string>;
}): Effect.Effect<void, GitHubSignatureVerificationError> => {
  if (signatureHeader === undefined || !signatureHeader.startsWith("sha256=")) {
    return Effect.fail(
      new IntegrationRequestSignatureError({
        reason: "GitHub webhook signature is missing or invalid",
      })
    );
  }
  const expected = createHmac("sha256", Redacted.value(webhookSecret))
    .update(rawBody)
    .digest("hex");
  const received = signatureHeader.slice("sha256=".length);
  const expectedBuffer = Buffer.from(expected, "hex");
  const receivedBuffer = Buffer.from(received, "hex");
  return expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
    ? Effect.void
    : Effect.fail(
        new IntegrationRequestSignatureError({
          reason: "GitHub webhook signature does not match",
        })
      );
};

import { createHmac } from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import { verifyGitHubWebhookSignature } from "./github-signature";

const webhookSecret = Redacted.make("github-webhook-secret");
const signatureFor = (rawBody: string) =>
  `sha256=${createHmac("sha256", Redacted.value(webhookSecret))
    .update(rawBody)
    .digest("hex")}`;

describe("verifyGitHubWebhookSignature", () => {
  it.effect("accepts an HMAC SHA-256 signature over the raw body", () =>
    Effect.gen(function* () {
      const rawBody = '{"action":"closed"}';
      yield* verifyGitHubWebhookSignature({
        rawBody,
        signatureHeader: signatureFor(rawBody),
        webhookSecret,
      });
    })
  );

  it.effect("rejects a tampered request", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        verifyGitHubWebhookSignature({
          rawBody: "tampered",
          signatureHeader: signatureFor("original"),
          webhookSecret,
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );
});

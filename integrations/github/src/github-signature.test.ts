import { createHmac } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import { verifyGitHubWebhookSignature } from "./github-signature";

const webhookSecret = Redacted.make("github-webhook-secret");
const signatureFor = (rawBody: string) =>
  `sha256=${createHmac("sha256", Redacted.value(webhookSecret))
    .update(rawBody)
    .digest("hex")}`;

describe("verifyGitHubWebhookSignature", () => {
  it("accepts an HMAC SHA-256 signature over the raw body", async () => {
    const rawBody = '{"action":"closed"}';
    await Effect.runPromise(
      verifyGitHubWebhookSignature({
        rawBody,
        signatureHeader: signatureFor(rawBody),
        webhookSecret,
      })
    );
  });

  it("rejects a tampered request", async () => {
    const result = await Effect.runPromiseExit(
      verifyGitHubWebhookSignature({
        rawBody: "tampered",
        signatureHeader: signatureFor("original"),
        webhookSecret,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});

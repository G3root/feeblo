import { createHmac } from "node:crypto";

import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import {
  SLACK_SIGNATURE_MAX_AGE_MS,
  verifySlackRequestSignature,
} from "./slack-signature";

const signingSecret = Redacted.make("secret-signing-secret");

const sign = (timestamp: string, rawBody: string) =>
  `v0=${createHmac("sha256", Redacted.value(signingSecret))
    .update(`v0:${timestamp}:${rawBody}`)
    .digest("hex")}`;

describe("verifySlackRequestSignature", () => {
  it.effect("accepts a valid signature", () =>
    Effect.gen(function* () {
      const rawBody = "command=/feeblo&text=hello";
      const timestamp = String(
        Math.floor((yield* Clock.currentTimeMillis) / 1000)
      );
      const result = yield* verifySlackRequestSignature({
        now: yield* Clock.currentTimeMillis,
        rawBody,
        signatureHeader: sign(timestamp, rawBody),
        signingSecret,
        timestampHeader: timestamp,
      });
      expect(result).toBeUndefined();
    })
  );

  it.effect("rejects a missing header", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        verifySlackRequestSignature({
          now: yield* Clock.currentTimeMillis,
          rawBody: "{}",
          signingSecret,
          timestampHeader: undefined,
          signatureHeader: undefined,
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );

  it.effect("rejects a stale timestamp outside the freshness window", () =>
    Effect.gen(function* () {
      const rawBody = "{}";
      const stale = String(
        Math.floor(
          ((yield* Clock.currentTimeMillis) -
            SLACK_SIGNATURE_MAX_AGE_MS -
            60_000) /
            1000
        )
      );
      const result = yield* Effect.exit(
        verifySlackRequestSignature({
          now: yield* Clock.currentTimeMillis,
          rawBody,
          signatureHeader: sign(stale, rawBody),
          signingSecret,
          timestampHeader: stale,
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );

  it.effect("rejects a tampered body", () =>
    Effect.gen(function* () {
      const timestamp = String(
        Math.floor((yield* Clock.currentTimeMillis) / 1000)
      );
      const result = yield* Effect.exit(
        verifySlackRequestSignature({
          now: yield* Clock.currentTimeMillis,
          rawBody: "tampered",
          signatureHeader: sign(timestamp, "original"),
          signingSecret,
          timestampHeader: timestamp,
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );

  it.effect("rejects a non-v0 signature scheme", () =>
    Effect.gen(function* () {
      const timestamp = String(
        Math.floor((yield* Clock.currentTimeMillis) / 1000)
      );
      const result = yield* Effect.exit(
        verifySlackRequestSignature({
          now: yield* Clock.currentTimeMillis,
          rawBody: "{}",
          signatureHeader: "v1=abc",
          signingSecret,
          timestampHeader: timestamp,
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );
});

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import {
  IntegrationRequestSignatureError,
  verifyRequestSignature,
} from "./request-signature";

const okVerify = () =>
  verifyRequestSignature({
    maxAgeMs: 60_000,
    signatureHeader: "sig",
    timestampHeader: String(Math.floor(Date.now() / 1000)),
    verify: () => Effect.void,
  });

describe("verifyRequestSignature", () => {
  it.effect("accepts a fresh request and delegates to the provider check", () =>
    okVerify().pipe(
      Effect.tap((result) => Effect.sync(() => expect(result).toBeUndefined()))
    )
  );

  it.effect("rejects a missing header", () =>
    Effect.gen(function* () {
      let verified = false;
      const failure = yield* Effect.flip(
        verifyRequestSignature({
          maxAgeMs: 60_000,
          signatureHeader: undefined,
          timestampHeader: undefined,
          verify: () =>
            Effect.sync(() => {
              verified = true;
            }),
        })
      );
      expect(failure.reason).toBe("Request signature headers are missing");
      expect(verified).toBe(false);
    })
  );

  it.effect("rejects a stale timestamp outside the freshness window", () =>
    Effect.gen(function* () {
      const stale = String(Math.floor((Date.now() - 120_000) / 1000));
      const failure = yield* Effect.flip(
        verifyRequestSignature({
          maxAgeMs: 60_000,
          signatureHeader: "sig",
          timestampHeader: stale,
          verify: () => Effect.void,
        })
      );
      expect(failure.reason).toBe("Request timestamp is stale");
    })
  );

  it.effect("rejects a non-numeric timestamp", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        verifyRequestSignature({
          maxAgeMs: 60_000,
          signatureHeader: "sig",
          timestampHeader: "not-a-timestamp",
          verify: () => Effect.void,
        })
      );
      expect(failure.reason).toBe("Request timestamp is invalid");
    })
  );

  it.effect("surfaces the provider check failure", () =>
    Effect.gen(function* () {
      const failure = yield* Effect.flip(
        verifyRequestSignature({
          maxAgeMs: 60_000,
          signatureHeader: "sig",
          timestampHeader: String(Math.floor(Date.now() / 1000)),
          verify: () =>
            Effect.fail(
              new IntegrationRequestSignatureError({
                reason: "cryptographic check failed",
              })
            ),
        })
      );
      expect(failure.reason).toBe("cryptographic check failed");
    })
  );
});

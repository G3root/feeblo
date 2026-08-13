import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";
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
  it("accepts a fresh request and delegates to the provider check", async () => {
    const result = await Effect.runPromise(okVerify());
    expect(result).toBeUndefined();
  });

  it("rejects a missing header", async () => {
    const result = await Effect.runPromiseExit(
      verifyRequestSignature({
        maxAgeMs: 60_000,
        signatureHeader: undefined,
        timestampHeader: undefined,
        verify: () => Effect.void,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects a stale timestamp outside the freshness window", async () => {
    const stale = String(Math.floor((Date.now() - 120_000) / 1000));
    const result = await Effect.runPromiseExit(
      verifyRequestSignature({
        maxAgeMs: 60_000,
        signatureHeader: "sig",
        timestampHeader: stale,
        verify: () => Effect.void,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects a non-numeric timestamp", async () => {
    const result = await Effect.runPromiseExit(
      verifyRequestSignature({
        maxAgeMs: 60_000,
        signatureHeader: "sig",
        timestampHeader: "not-a-timestamp",
        verify: () => Effect.void,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("surfaces the provider check failure", async () => {
    const result = await Effect.runPromiseExit(
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
    expect(Exit.isFailure(result)).toBe(true);
  });
});

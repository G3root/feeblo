import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import {
  DISCORD_SIGNATURE_MAX_AGE_MS,
  verifyDiscordRequestSignature,
} from "./discord-signature";

// Discord public keys are 32-byte Ed25519 keys as 64 hex chars. The test
// keypair is generated inline so the tests never depend on a fixture secret.
const { publicKeyHex, privateKeyHex } = (() => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyHex = publicKey
    .export({ format: "der", type: "spki" })
    .subarray(-32)
    .toString("hex");
  const privateKeyHex = privateKey
    .export({ format: "der", type: "pkcs8" })
    .toString("hex");
  return { publicKeyHex, privateKeyHex };
})();

const signBody = (timestamp: string, rawBody: string) =>
  sign(
    null,
    Buffer.from(`${timestamp}${rawBody}`),
    createPrivateKey({
      key: Buffer.from(privateKeyHex, "hex"),
      format: "der",
      type: "pkcs8",
    })
  ).toString("hex");

const expectFailure = <A, E>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.exit,
    Effect.tap((result) =>
      Effect.sync(() => expect(Exit.isFailure(result)).toBe(true))
    )
  );

describe("verifyDiscordRequestSignature", () => {
  it.effect("accepts a valid signature", () =>
    Effect.gen(function* () {
      const rawBody = JSON.stringify({ type: 1 });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const result = yield* verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody,
        signatureHeader: signBody(timestamp, rawBody),
        timestampHeader: timestamp,
      });
      expect(result).toBeUndefined();
    })
  );

  it.effect("rejects a missing header", () =>
    expectFailure(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody: "{}",
        signatureHeader: undefined,
        timestampHeader: undefined,
      })
    )
  );

  it.effect("rejects a stale timestamp outside the freshness window", () => {
    const rawBody = "{}";
    const stale = String(
      Math.floor((Date.now() - DISCORD_SIGNATURE_MAX_AGE_MS - 60_000) / 1000)
    );
    return expectFailure(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody,
        signatureHeader: signBody(stale, rawBody),
        timestampHeader: stale,
      })
    );
  });

  it.effect("rejects a future timestamp outside the freshness window", () => {
    const rawBody = "{}";
    const now = Date.now();
    const future = String(
      Math.floor((now + DISCORD_SIGNATURE_MAX_AGE_MS + 60_000) / 1000)
    );
    return expectFailure(
      verifyDiscordRequestSignature({
        now,
        publicKey: publicKeyHex,
        rawBody,
        signatureHeader: signBody(future, rawBody),
        timestampHeader: future,
      })
    );
  });

  it.effect("rejects a tampered body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return expectFailure(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody: "tampered",
        signatureHeader: signBody(timestamp, "original"),
        timestampHeader: timestamp,
      })
    );
  });

  it.effect("rejects a non-hex signature", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return expectFailure(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody: "{}",
        signatureHeader: "not-a-signature",
        timestampHeader: timestamp,
      })
    );
  });

  it.effect("rejects an invalid public key", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return expectFailure(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: "zz",
        rawBody: "{}",
        signatureHeader: signBody(timestamp, "{}"),
        timestampHeader: timestamp,
      })
    );
  });
});

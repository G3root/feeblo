import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import { describe, expect, it } from "vitest";
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

describe("verifyDiscordRequestSignature", () => {
  it("accepts a valid signature", async () => {
    const rawBody = JSON.stringify({ type: 1 });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = await Effect.runPromise(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody,
        signatureHeader: signBody(timestamp, rawBody),
        timestampHeader: timestamp,
      })
    );
    expect(result).toBeUndefined();
  });

  it("rejects a missing header", async () => {
    const result = await Effect.runPromiseExit(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody: "{}",
        signatureHeader: undefined,
        timestampHeader: undefined,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects a stale timestamp outside the freshness window", async () => {
    const rawBody = "{}";
    const stale = String(
      Math.floor((Date.now() - DISCORD_SIGNATURE_MAX_AGE_MS - 60_000) / 1000)
    );
    const result = await Effect.runPromiseExit(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody,
        signatureHeader: signBody(stale, rawBody),
        timestampHeader: stale,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects a tampered body", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = await Effect.runPromiseExit(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody: "tampered",
        signatureHeader: signBody(timestamp, "original"),
        timestampHeader: timestamp,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects a non-hex signature", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = await Effect.runPromiseExit(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: publicKeyHex,
        rawBody: "{}",
        signatureHeader: "not-a-signature",
        timestampHeader: timestamp,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("rejects an invalid public key", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const result = await Effect.runPromiseExit(
      verifyDiscordRequestSignature({
        now: Date.now(),
        publicKey: "zz",
        rawBody: "{}",
        signatureHeader: signBody(timestamp, "{}"),
        timestampHeader: timestamp,
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});

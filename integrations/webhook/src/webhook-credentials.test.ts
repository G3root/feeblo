import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import {
  decryptWebhookCredentialMaterial,
  encryptWebhookCredentialMaterial,
  validateWebhookEncryptionKey,
} from "./webhook-credentials";

describe("webhook credential material", () => {
  const key = Redacted.make("0123456789abcdef0123456789abcdef");
  const material = {
    endpointUrl: "https://hooks.example.com/a",
    signingKeyring: {
      current: "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI=",
    },
  };
  it.effect(
    "encrypts the whole structured credential and returns redacted decrypted secrets",
    () =>
      Effect.gen(function* () {
        const encrypted = yield* encryptWebhookCredentialMaterial(
          key,
          material
        );
        expect(encrypted).not.toContain(material.endpointUrl);
        const decoded = yield* decryptWebhookCredentialMaterial(key, encrypted);
        expect(decoded.endpointUrl).not.toContain(material.endpointUrl);
        expect(Redacted.value(decoded.endpointUrl)).toBe(material.endpointUrl);
      })
  );
  it.effect(
    "fails malformed stored ciphertext and short keys as typed failures",
    () =>
      Effect.gen(function* () {
        const shortKeyExit = yield* Effect.exit(
          validateWebhookEncryptionKey(Redacted.make("short"))
        );
        expect(Exit.isFailure(shortKeyExit)).toBe(true);

        const ciphertextExit = yield* Effect.exit(
          decryptWebhookCredentialMaterial(key, "not-ciphertext")
        );
        expect(Exit.isFailure(ciphertextExit)).toBe(true);
      })
  );
});

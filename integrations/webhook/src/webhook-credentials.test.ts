import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";

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
  it("encrypts the whole structured credential and returns redacted decrypted secrets", async () => {
    const encrypted = await Effect.runPromise(
      encryptWebhookCredentialMaterial(key, material)
    );
    expect(encrypted).not.toContain(material.endpointUrl);
    const decoded = await Effect.runPromise(
      decryptWebhookCredentialMaterial(key, encrypted)
    );
    expect(decoded.endpointUrl).not.toContain(material.endpointUrl);
    expect(Redacted.value(decoded.endpointUrl)).toBe(material.endpointUrl);
  });
  it("fails malformed stored ciphertext and short keys as typed failures", () => {
    expect(
      Exit.isFailure(
        Effect.runSyncExit(validateWebhookEncryptionKey(Redacted.make("short")))
      )
    ).toBe(true);
    expect(
      Exit.isFailure(
        Effect.runSyncExit(
          decryptWebhookCredentialMaterial(key, "not-ciphertext")
        )
      )
    ).toBe(true);
  });
});

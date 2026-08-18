import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import {
  decryptIntegrationCredentialMaterial,
  encryptIntegrationCredentialMaterial,
} from "./credential-encryption";

const encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef");

/** Minimal provider material shape exercising the generic helpers. */
const TestCredentialMaterial = Schema.Struct({
  secret: Schema.optionalKey(Schema.String),
  oauthState: Schema.optionalKey(Schema.String),
});

describe("integration credential material", () => {
  it("round-trips material through encrypt and decrypt", async () => {
    const ciphertext = await Effect.runPromise(
      encryptIntegrationCredentialMaterial(
        encryptionKey,
        TestCredentialMaterial,
        {
          oauthState: "state-nonce",
          secret: "provider-secret",
        }
      )
    );
    expect(ciphertext).not.toContain("state-nonce");
    expect(ciphertext).not.toContain("provider-secret");

    const decrypted = await Effect.runPromise(
      decryptIntegrationCredentialMaterial(
        encryptionKey,
        TestCredentialMaterial,
        ciphertext,
        (material) => ({
          ...(material.secret === undefined
            ? {}
            : { secret: Redacted.make(material.secret) }),
          ...(material.oauthState === undefined
            ? {}
            : { oauthState: material.oauthState }),
        })
      )
    );
    expect(decrypted.oauthState).toBe("state-nonce");
    if (decrypted.secret === undefined) {
      throw new Error("expected secret");
    }
    expect(Redacted.value(decrypted.secret)).toBe("provider-secret");
  });

  it("rejects a short encryption key", async () => {
    const result = await Effect.runPromiseExit(
      encryptIntegrationCredentialMaterial(
        Redacted.make("short"),
        TestCredentialMaterial,
        {}
      )
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("fails to decrypt malformed ciphertext", async () => {
    const result = await Effect.runPromiseExit(
      decryptIntegrationCredentialMaterial(
        encryptionKey,
        TestCredentialMaterial,
        "not-ciphertext",
        (material) => material
      )
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("fails to decrypt material that decodes against the wrong schema", async () => {
    const ciphertext = await Effect.runPromise(
      encryptIntegrationCredentialMaterial(
        encryptionKey,
        TestCredentialMaterial,
        {
          secret: "provider-secret",
        }
      )
    );
    const WrongMaterial = Schema.Struct({ required: Schema.String });
    const result = await Effect.runPromiseExit(
      decryptIntegrationCredentialMaterial(
        encryptionKey,
        WrongMaterial,
        ciphertext,
        (material) => material
      )
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});

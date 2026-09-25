import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

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
  it.effect("round-trips material through encrypt and decrypt", () =>
    Effect.gen(function* () {
      const ciphertext = yield* encryptIntegrationCredentialMaterial(
        encryptionKey,
        TestCredentialMaterial,
        {
          oauthState: "state-nonce",
          secret: "provider-secret",
        }
      );
      expect(ciphertext).not.toContain("state-nonce");
      expect(ciphertext).not.toContain("provider-secret");

      const decrypted = yield* decryptIntegrationCredentialMaterial(
        encryptionKey,
        TestCredentialMaterial,
        ciphertext,
        (material) => ({
          ...(material.secret === undefined
            ? undefined
            : { secret: Redacted.make(material.secret) }),
          ...(material.oauthState === undefined
            ? undefined
            : { oauthState: material.oauthState }),
        })
      );
      expect(decrypted.oauthState).toBe("state-nonce");
      if (decrypted.secret === undefined) {
        throw new Error("expected secret");
      }
      expect(Redacted.value(decrypted.secret)).toBe("provider-secret");
    })
  );

  it.effect("rejects a short encryption key", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        encryptIntegrationCredentialMaterial(
          Redacted.make("short"),
          TestCredentialMaterial,
          {}
        )
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );

  it.effect("fails to decrypt malformed ciphertext", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decryptIntegrationCredentialMaterial(
          encryptionKey,
          TestCredentialMaterial,
          "not-ciphertext",
          (material) => material
        )
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );

  it.effect(
    "fails to decrypt material that decodes against the wrong schema",
    () =>
      Effect.gen(function* () {
        const ciphertext = yield* encryptIntegrationCredentialMaterial(
          encryptionKey,
          TestCredentialMaterial,
          {
            secret: "provider-secret",
          }
        );
        const WrongMaterial = Schema.Struct({ required: Schema.String });
        const result = yield* Effect.exit(
          decryptIntegrationCredentialMaterial(
            encryptionKey,
            WrongMaterial,
            ciphertext,
            (material) => material
          )
        );
        expect(Exit.isFailure(result)).toBe(true);
      })
  );
});

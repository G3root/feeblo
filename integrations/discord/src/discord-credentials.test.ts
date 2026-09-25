import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import {
  decryptDiscordCredentialMaterial,
  encryptDiscordCredentialMaterial,
} from "./discord-credentials";

const encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef");

describe("discord credential material", () => {
  it.effect("round-trips the oauth state and user token", () =>
    Effect.gen(function* () {
      const ciphertext = yield* encryptDiscordCredentialMaterial(
        encryptionKey,
        {
          oauthState: "state-nonce",
          userToken: "discord-user-token",
        }
      );
      expect(ciphertext).not.toContain("state-nonce");
      expect(ciphertext).not.toContain("discord-user-token");

      const decrypted = yield* decryptDiscordCredentialMaterial(
        encryptionKey,
        ciphertext
      );
      expect(decrypted.oauthState).toBe("state-nonce");
      if (decrypted.userToken === undefined) {
        throw new Error("expected user token");
      }
      expect(Redacted.value(decrypted.userToken)).toBe("discord-user-token");
    })
  );

  it.effect("rejects a short encryption key", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        encryptDiscordCredentialMaterial(Redacted.make("short"), {
          oauthState: "state-nonce",
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );

  it.effect("fails to decrypt malformed ciphertext", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decryptDiscordCredentialMaterial(encryptionKey, "not-ciphertext")
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );
});

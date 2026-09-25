import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import {
  decryptSlackCredentialMaterial,
  encryptSlackCredentialMaterial,
} from "./slack-credentials";

const encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef");

describe("slack credential material", () => {
  it.effect("round-trips the bot token and oauth state", () =>
    Effect.gen(function* () {
      const ciphertext = yield* encryptSlackCredentialMaterial(encryptionKey, {
        botToken: "xoxb-secret-token",
        oauthState: "state-nonce",
      });
      expect(ciphertext).not.toContain("xoxb-secret-token");
      expect(ciphertext).not.toContain("state-nonce");

      const decrypted = yield* decryptSlackCredentialMaterial(
        encryptionKey,
        ciphertext
      );
      if (decrypted.botToken === undefined) {
        throw new Error("expected bot token");
      }
      expect(Redacted.value(decrypted.botToken)).toBe("xoxb-secret-token");
      expect(decrypted.oauthState).toBe("state-nonce");
    })
  );

  it.effect("rejects a short encryption key", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        encryptSlackCredentialMaterial(Redacted.make("short"), {
          botToken: "xoxb-token",
        })
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );

  it.effect("fails to decrypt malformed ciphertext", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decryptSlackCredentialMaterial(encryptionKey, "not-ciphertext")
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );
});

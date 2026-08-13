import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import {
  decryptDiscordCredentialMaterial,
  encryptDiscordCredentialMaterial,
} from "./discord-credentials";

const encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef");

describe("discord credential material", () => {
  it("round-trips the oauth state and user token", async () => {
    const ciphertext = await Effect.runPromise(
      encryptDiscordCredentialMaterial(encryptionKey, {
        oauthState: "state-nonce",
        userToken: "discord-user-token",
      })
    );
    expect(ciphertext).not.toContain("state-nonce");
    expect(ciphertext).not.toContain("discord-user-token");

    const decrypted = await Effect.runPromise(
      decryptDiscordCredentialMaterial(encryptionKey, ciphertext)
    );
    expect(decrypted.oauthState).toBe("state-nonce");
    if (decrypted.userToken === undefined) {
      throw new Error("expected user token");
    }
    expect(Redacted.value(decrypted.userToken)).toBe("discord-user-token");
  });

  it("rejects a short encryption key", async () => {
    const result = await Effect.runPromiseExit(
      encryptDiscordCredentialMaterial(Redacted.make("short"), {
        oauthState: "state-nonce",
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("fails to decrypt malformed ciphertext", async () => {
    const result = await Effect.runPromiseExit(
      decryptDiscordCredentialMaterial(encryptionKey, "not-ciphertext")
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});

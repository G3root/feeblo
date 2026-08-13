import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import {
  decryptSlackCredentialMaterial,
  encryptSlackCredentialMaterial,
} from "./slack-credentials";

const encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef");

describe("slack credential material", () => {
  it("round-trips the bot token and oauth state", async () => {
    const ciphertext = await Effect.runPromise(
      encryptSlackCredentialMaterial(encryptionKey, {
        botToken: "xoxb-secret-token",
        oauthState: "state-nonce",
      })
    );
    expect(ciphertext).not.toContain("xoxb-secret-token");
    expect(ciphertext).not.toContain("state-nonce");

    const decrypted = await Effect.runPromise(
      decryptSlackCredentialMaterial(encryptionKey, ciphertext)
    );
    if (decrypted.botToken === undefined) {
      throw new Error("expected bot token");
    }
    expect(Redacted.value(decrypted.botToken)).toBe("xoxb-secret-token");
    expect(decrypted.oauthState).toBe("state-nonce");
  });

  it("rejects a short encryption key", async () => {
    const result = await Effect.runPromiseExit(
      encryptSlackCredentialMaterial(Redacted.make("short"), {
        botToken: "xoxb-token",
      })
    );
    expect(Exit.isFailure(result)).toBe(true);
  });

  it("fails to decrypt malformed ciphertext", async () => {
    const result = await Effect.runPromiseExit(
      decryptSlackCredentialMaterial(encryptionKey, "not-ciphertext")
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});

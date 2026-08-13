import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";
import { describe, expect, it } from "vitest";
import {
  decryptGitHubCredentialMaterial,
  encryptGitHubCredentialMaterial,
} from "./github-credentials";

const encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef");

describe("GitHub credential material", () => {
  it("encrypts durable GitHub App installation state", async () => {
    const ciphertext = await Effect.runPromise(
      encryptGitHubCredentialMaterial(encryptionKey, {
        installationId: "1234",
        installationState: "state-nonce",
      })
    );
    expect(ciphertext).not.toContain("state-nonce");
    const credentials = await Effect.runPromise(
      decryptGitHubCredentialMaterial(encryptionKey, ciphertext)
    );
    expect(credentials.installationState).toBe("state-nonce");
    expect(credentials.installationId).toBe("1234");
  });

  it("rejects malformed encrypted material", async () => {
    const result = await Effect.runPromiseExit(
      decryptGitHubCredentialMaterial(encryptionKey, "not-ciphertext")
    );
    expect(Exit.isFailure(result)).toBe(true);
  });
});

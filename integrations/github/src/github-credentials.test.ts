import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Redacted from "effect/Redacted";

import {
  decryptGitHubCredentialMaterial,
  encryptGitHubCredentialMaterial,
} from "./github-credentials";

const encryptionKey = Redacted.make("0123456789abcdef0123456789abcdef");

describe("GitHub credential material", () => {
  it.effect("encrypts durable GitHub App installation state", () =>
    Effect.gen(function* () {
      const ciphertext = yield* encryptGitHubCredentialMaterial(encryptionKey, {
        installationId: "1234",
        installationState: "state-nonce",
      });
      expect(ciphertext).not.toContain("state-nonce");
      const credentials = yield* decryptGitHubCredentialMaterial(
        encryptionKey,
        ciphertext
      );
      expect(credentials.installationState).toBe("state-nonce");
      expect(credentials.installationId).toBe("1234");
    })
  );

  it.effect("rejects malformed encrypted material", () =>
    Effect.gen(function* () {
      const result = yield* Effect.exit(
        decryptGitHubCredentialMaterial(encryptionKey, "not-ciphertext")
      );
      expect(Exit.isFailure(result)).toBe(true);
    })
  );
});

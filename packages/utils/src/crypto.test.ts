import { describe, expect, it } from "vitest";

import { symmetricDecrypt, symmetricEncrypt } from "./crypto";

describe("symmetric crypto via HKDF", () => {
  it("round-trips encrypt/decrypt with HKDF-derived key", async () => {
    const key = "test-auth-encryption-key-with-enough-entropy-1234";
    const data = JSON.stringify({
      email: "test@example.com",
      type: "email-verification",
    });
    const encrypted = await symmetricEncrypt({ key, data });
    const decrypted = await symmetricDecrypt({ key, data: encrypted });
    expect(decrypted).toBe(data);
  });

  it("is deterministic per key but different keys give different ciphertext", async () => {
    const keyA = "key-a-32-chars-long-entropy-here!!";
    const keyB = "key-b-32-chars-long-entropy-here!!";
    const data = "hello world";
    const encA1 = await symmetricEncrypt({ key: keyA, data });
    const encA2 = await symmetricEncrypt({ key: keyA, data });
    // managedNonce uses random nonce, so ciphertext differs per call, but decrypt succeeds
    expect(encA1).not.toBe(encA2);
    const encB = await symmetricEncrypt({ key: keyB, data });
    expect(encA1).not.toBe(encB);
    expect(await symmetricDecrypt({ key: keyA, data: encA1 })).toBe(data);
    expect(await symmetricDecrypt({ key: keyA, data: encA2 })).toBe(data);
  });

  it("fails to decrypt with wrong key", async () => {
    const key = "correct-key-32-chars-entropy-here!!";
    const wrongKey = "wrong-key-32-chars-entropy-here!!!";
    const data = "secret payload";
    const encrypted = await symmetricEncrypt({ key, data });
    await expect(
      symmetricDecrypt({ key: wrongKey, data: encrypted })
    ).rejects.toThrow(expect.anything());
  });

  it("handles empty string and unicode", async () => {
    const key = "unicode-test-key-32-chars-xxxxxx!!";
    for (const data of ["", "🦄 emoji test", "a".repeat(10_000)]) {
      const enc = await symmetricEncrypt({ key, data });
      expect(await symmetricDecrypt({ key, data: enc })).toBe(data);
    }
  });
});

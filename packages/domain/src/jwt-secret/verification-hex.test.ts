import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as jose from "jose";

import { verifyJwt } from "./verification";

const ORGANIZATION_ID = "org_test_hex";
const futureExp = Math.floor(Date.now() / 1000) + 3600;

// 32 random bytes as 64-char hex (the format JwtSecretRepository generates)
const HEX_SECRET = "a".repeat(64); // 64 hex chars -> 00...
const HEX_SECRET_2 = "b".repeat(64);
const LEGACY_SECRET = "legacy-plain-secret";

async function signWithHex(payload: jose.JWTPayload, hexSecret: string) {
  const key = new Uint8Array(Buffer.from(hexSecret, "hex"));
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(key);
}

async function signWithUtf8(payload: jose.JWTPayload, secret: string) {
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));
}

describe("verifyJwt hex secret handling", () => {
  it.effect(
    "verifies token signed with raw hex bytes using 64-char hex secret",
    () =>
      Effect.gen(function* () {
        const token = yield* Effect.promise(() =>
          signWithHex(
            { aud: ORGANIZATION_ID, exp: futureExp, sub: "u1" },
            HEX_SECRET
          )
        );
        const payload = yield* verifyJwt(token, [HEX_SECRET], ORGANIZATION_ID);
        expect(payload.sub).toBe("u1");
      })
  );

  it.effect("verifies token signed with utf8 legacy secret", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signWithUtf8(
          { aud: ORGANIZATION_ID, exp: futureExp, sub: "legacy" },
          LEGACY_SECRET
        )
      );
      const payload = yield* verifyJwt(token, [LEGACY_SECRET], ORGANIZATION_ID);
      expect(payload.sub).toBe("legacy");
    })
  );

  it("rejects token signed with utf8-encoded hex when verifier expects hex decode (mismatch)", async () => {
    // Signing with UTF-8 bytes of the hex string is different from raw hex bytes.
    const tokenUtf8 = await signWithUtf8(
      { aud: ORGANIZATION_ID, exp: futureExp },
      HEX_SECRET
    );
    await expect(
      Effect.runPromise(verifyJwt(tokenUtf8, [HEX_SECRET], ORGANIZATION_ID))
    ).rejects.toBeDefined();
  });

  it.effect(
    "succeeds when one of multiple secrets (hex + legacy) matches",
    () =>
      Effect.gen(function* () {
        const token = yield* Effect.promise(() =>
          signWithHex(
            { aud: ORGANIZATION_ID, exp: futureExp, sub: "u2" },
            HEX_SECRET_2
          )
        );
        const payload = yield* verifyJwt(
          token,
          [HEX_SECRET, HEX_SECRET_2, LEGACY_SECRET],
          ORGANIZATION_ID
        );
        expect(payload.sub).toBe("u2");
      })
  );

  it("rejects oversized token (>16KiB)", async () => {
    const big = "a".repeat(17 * 1024);
    await expect(
      Effect.runPromise(verifyJwt(big, [HEX_SECRET], ORGANIZATION_ID))
    ).rejects.toBeDefined();
  });
});

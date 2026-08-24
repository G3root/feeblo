import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as jose from "jose";

import { DataValidationError } from "./errors";
import { parsePersonAttributes } from "./utils";

const SECRET = new TextEncoder().encode("test-secret");

async function signAndVerify<T extends jose.JWTPayload>(payload: T) {
  const token = await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(SECRET);

  const { payload: verified } = await jose.jwtVerify(token, SECRET, {
    algorithms: ["HS256"],
  });

  return verified;
}

describe("JWT payload parsing", () => {
  it.effect("parses a realistic JWT-shaped payload", () =>
    Effect.gen(function* () {
      const userData = {
        userId: "user_123",
        email: "test@example.com",
        name: "Alice",
        avatar: "https://example.com/avatar.png",
        customFields: {
          title: "Product Manager",
          plan: "Premium",
        },
        companies: [
          {
            id: "987654321",
            name: "Business Inc. 23",
            avatar: "https://example.com/company.png",
            createdAt: "2023-05-19T15:35:49.915Z",
            customFields: {
              industry: "Fintech",
              location: "Canada",
            },
          },
        ],
      };

      const verified = yield* Effect.promise(() => signAndVerify(userData));

      const result = yield* parsePersonAttributes(verified, [], []);

      expect(result.commonFields).toEqual({
        userId: "user_123",
        email: "test@example.com",
        name: "Alice",
        avatar: "https://example.com/avatar.png",
      });
      expect(result.customAttributes).toEqual([]);
      expect(result.companies).toHaveLength(1);
      expect(result.companies[0]?.commonFields).toEqual({
        id: "987654321",
        name: "Business Inc. 23",
        avatar: "https://example.com/company.png",
        externalCreatedAt: new Date("2023-05-19T15:35:49.915Z"),
      });
    })
  );

  it.effect("ignores standard JWT claims (iss, iat, exp, aud) except sub", () =>
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000);
      const userData = {
        sub: "user_123",
        email: "test@example.com",
        name: "Alice",
        iss: "feeblo",
        iat: now,
        exp: now + 60,
        aud: "feeblo-app",
      };

      const verified = yield* Effect.promise(() => signAndVerify(userData));

      const result = yield* parsePersonAttributes(verified, [], []);

      expect(result.commonFields).toEqual({
        userId: "user_123",
        email: "test@example.com",
        name: "Alice",
      });
      expect(result.customAttributes).toEqual([]);
    })
  );

  it.effect("falls back to userId when sub is absent", () =>
    Effect.gen(function* () {
      const verified = yield* Effect.promise(() =>
        signAndVerify({
          userId: "legacy_user",
          email: "test@example.com",
          name: "Alice",
        })
      );

      const result = yield* parsePersonAttributes(verified, [], []);

      expect(result.commonFields).toEqual({
        userId: "legacy_user",
        email: "test@example.com",
        name: "Alice",
      });
    })
  );

  it.effect("prefers sub over userId when both agree", () =>
    Effect.gen(function* () {
      const verified = yield* Effect.promise(() =>
        signAndVerify({
          sub: "user_123",
          userId: "user_123",
          email: "test@example.com",
          name: "Alice",
        })
      );

      const result = yield* parsePersonAttributes(verified, [], []);

      expect(result.commonFields.userId).toBe("user_123");
    })
  );

  it("rejects a token carrying sub and userId with different values", async () => {
    const verified = await signAndVerify({
      sub: "sub_user",
      userId: "legacy_user",
      email: "test@example.com",
      name: "Alice",
    });

    await expect(
      Effect.runPromise(parsePersonAttributes(verified, [], []))
    ).rejects.toBeInstanceOf(DataValidationError);
    await expect(
      Effect.runPromise(parsePersonAttributes(verified, [], []))
    ).rejects.toThrow("Conflicting identity");
  });

  it("fails when required fields (userId/sub, email, name) are missing", async () => {
    const verified = await signAndVerify({
      sub: "some-sub",
      iss: "feeblo",
    });

    await expect(
      Effect.runPromise(parsePersonAttributes(verified, [], []))
    ).rejects.toBeInstanceOf(DataValidationError);
  });
});

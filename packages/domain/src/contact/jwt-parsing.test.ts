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

  it.effect("ignores standard JWT claims (iss, sub, iat, exp, aud)", () =>
    Effect.gen(function* () {
      const now = Math.floor(Date.now() / 1000);
      const userData = {
        userId: "user_123",
        email: "test@example.com",
        name: "Alice",
        iss: "feeblo",
        sub: "some-sub",
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

  it("fails when required fields (userId, email, name) are missing", async () => {
    const verified = await signAndVerify({
      sub: "some-sub",
      iss: "feeblo",
    });

    try {
      await Effect.runPromise(parsePersonAttributes(verified, [], []));
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(DataValidationError);
    }
  });
});

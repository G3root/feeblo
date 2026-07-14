import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as jose from "jose";
import { verifyJwt } from "./verification";
import { UnauthorizedError } from "../rpc-errors";

const SECRET = "test-secret";
const OTHER_SECRET = "other-secret";

async function signToken(payload: jose.JWTPayload, secret: string) {
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));
}

describe("verifyJwt", () => {
  it.effect("verifies a valid token against the correct secret", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(
          { userId: "u_1", email: "test@example.com", name: "Ada" },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET]);

      expect(payload.userId).toBe("u_1");
      expect(payload.email).toBe("test@example.com");
      expect(payload.name).toBe("Ada");
    })
  );

  it.effect("succeeds when at least one secret matches", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken({ userId: "u_1" }, OTHER_SECRET)
      );

      const payload = yield* verifyJwt(token, [SECRET, OTHER_SECRET]);

      expect(payload.userId).toBe("u_1");
    })
  );

  it("fails when no secret matches", async () => {
    const token = await signToken({ userId: "u_1" }, "unknown-secret");

    try {
      await Effect.runPromise(verifyJwt(token, [SECRET]));
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedError);
    }
  });

  it("fails for a malformed token", async () => {
    try {
      await Effect.runPromise(verifyJwt("not-a-token", [SECRET]));
      expect.fail("Expected error was not thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedError);
    }
  });
});

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as jose from "jose";

import { UnauthorizedError } from "../rpc-errors";
import { verifyJwt } from "./verification";

const SECRET = "test-secret";
const OTHER_SECRET = "other-secret";
const ORGANIZATION_ID = "org_test";

async function signToken(payload: jose.JWTPayload, secret: string) {
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new TextEncoder().encode(secret));
}

const futureExp = Math.floor(Date.now() / 1000) + 3600;
const pastExp = Math.floor(Date.now() / 1000) - 3600;

describe("verifyJwt", () => {
  it.effect("verifies a token bound to the organization via aud with exp", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(
          {
            userId: "u_1",
            email: "test@example.com",
            name: "Ada",
            aud: ORGANIZATION_ID,
            exp: futureExp,
          },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);

      expect(payload.userId).toBe("u_1");
      expect(payload.email).toBe("test@example.com");
      expect(payload.name).toBe("Ada");
    })
  );

  it("rejects a token with the organization only in the iss claim", async () => {
    const token = await signToken(
      { userId: "u_1", iss: ORGANIZATION_ID, exp: futureExp },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("accepts a token without an exp claim (exp is optional)", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(
          {
            userId: "u_1",
            email: "test@example.com",
            name: "Ada",
            aud: ORGANIZATION_ID,
          },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);

      expect(payload.userId).toBe("u_1");
      expect(payload.aud).toBe(ORGANIZATION_ID);
    })
  );

  it("rejects an expired token when exp is present", async () => {
    const token = await signToken(
      { userId: "u_1", aud: ORGANIZATION_ID, exp: pastExp },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token bound to a different organization", async () => {
    const token = await signToken(
      { userId: "u_1", aud: "org_other", exp: futureExp },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects an unbound token (no aud claim)", async () => {
    const token = await signToken({ userId: "u_1", exp: futureExp }, SECRET);

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("succeeds when at least one secret matches", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(
          { userId: "u_1", aud: ORGANIZATION_ID, exp: futureExp },
          OTHER_SECRET
        )
      );

      const payload = yield* verifyJwt(
        token,
        [SECRET, OTHER_SECRET],
        ORGANIZATION_ID
      );

      expect(payload.userId).toBe("u_1");
    })
  );

  it("fails when no secret matches", async () => {
    const token = await signToken(
      { userId: "u_1", aud: ORGANIZATION_ID, exp: futureExp },
      "unknown-secret"
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("fails for a malformed token", async () => {
    await expect(
      Effect.runPromise(verifyJwt("not-a-token", [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

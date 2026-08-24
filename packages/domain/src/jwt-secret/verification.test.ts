import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as jose from "jose";

import { UnauthorizedError } from "../rpc-errors";
import { verifyJwt } from "./verification";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);
const ORGANIZATION_ID = "org_test";

const nowSeconds = () => Math.floor(Date.now() / 1000);
const futureExp = () => nowSeconds() + 3600;
const pastExp = () => nowSeconds() - 3600;

async function signToken(payload: jose.JWTPayload, secret: string) {
  return await new jose.SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .sign(new Uint8Array(Buffer.from(secret, "hex")));
}

const basePayload = (): jose.JWTPayload => ({
  userId: "u_1",
  email: "test@example.com",
  name: "Ada",
  aud: ORGANIZATION_ID,
  iat: nowSeconds(),
  exp: futureExp(),
});

describe("verifyJwt", () => {
  it.effect("verifies a token bound to the organization via aud with exp", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(basePayload(), SECRET)
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);

      expect(payload.userId).toBe("u_1");
      expect(payload.email).toBe("test@example.com");
      expect(payload.name).toBe("Ada");
    })
  );

  it("rejects a token with the organization only in the iss claim", async () => {
    const token = await signToken(
      { userId: "u_1", iss: ORGANIZATION_ID, exp: futureExp() },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token without an exp claim (exp is required)", async () => {
    const token = await signToken(
      {
        userId: "u_1",
        email: "test@example.com",
        name: "Ada",
        aud: ORGANIZATION_ID,
      },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects an expired token when exp is present", async () => {
    const token = await signToken({ ...basePayload(), exp: pastExp() }, SECRET);

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("accepts a token expired within the 30s clock-skew leeway", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(
          { ...basePayload(), iat: nowSeconds() - 60, exp: nowSeconds() - 10 },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);
      expect(payload.exp).toBe(nowSeconds() - 10);
    })
  );

  it("rejects a token with iat more than 30s in the future", async () => {
    const token = await signToken(
      { ...basePayload(), iat: nowSeconds() + 120 },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("accepts a token with iat within the 30s clock-skew leeway", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken({ ...basePayload(), iat: nowSeconds() + 10 }, SECRET)
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);
      expect(payload.iat).toBeGreaterThan(nowSeconds());
    })
  );

  it("rejects a token with a lifetime beyond the 24h default cap", async () => {
    const token = await signToken(
      {
        ...basePayload(),
        iat: nowSeconds(),
        exp: nowSeconds() + 25 * 3600,
      },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token without iat whose exp is beyond the 24h default cap", async () => {
    const { iat: _iat, ...payloadWithoutIat } = basePayload();
    const token = await signToken(
      { ...payloadWithoutIat, exp: nowSeconds() + 25 * 3600 },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("accepts a token with a lifetime within the default cap", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(
          {
            ...basePayload(),
            iat: nowSeconds(),
            exp: nowSeconds() + 23 * 3600,
          },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);
      expect(payload.exp).toBeDefined();
    })
  );

  it("respects a per-workspace maxTokenLifetime override", async () => {
    // 2-hour cap: a 3-hour token must be rejected even though the 24h
    // default would accept it.
    const token = await signToken(
      {
        ...basePayload(),
        iat: nowSeconds(),
        exp: nowSeconds() + 3 * 3600,
      },
      SECRET
    );

    await expect(
      Effect.runPromise(
        verifyJwt(token, [SECRET], ORGANIZATION_ID, {
          maxTokenLifetime: Duration.hours(2),
        })
      )
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("accepts a token within a tightened per-workspace cap", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(
          { ...basePayload(), iat: nowSeconds(), exp: nowSeconds() + 3600 },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID, {
        maxTokenLifetime: Duration.hours(2),
      });
      expect(payload.exp).toBeDefined();
    })
  );

  it("rejects a token bound to a different organization", async () => {
    const token = await signToken(
      { ...basePayload(), aud: "org_other" },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects an unbound token (no aud claim)", async () => {
    const { aud: _aud, ...payloadWithoutAud } = basePayload();
    const token = await signToken(payloadWithoutAud, SECRET);

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("succeeds when at least one secret matches", () =>
    Effect.gen(function* () {
      const token = yield* Effect.promise(() =>
        signToken(basePayload(), OTHER_SECRET)
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
    const token = await signToken(basePayload(), "c".repeat(64));

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

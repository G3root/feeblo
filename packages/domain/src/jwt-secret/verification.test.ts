import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as jose from "jose";

import { UnauthorizedError } from "../rpc-errors";
import { CLOCK_SKEW_LEEWAY_SECONDS, verifyJwt } from "./verification";

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
  sub: "u_1",
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

      expect(payload.sub).toBe("u_1");
      expect(payload.email).toBe("test@example.com");
      expect(payload.name).toBe("Ada");
    })
  );

  it("rejects a token with the organization only in the iss claim", async () => {
    const token = await signToken(
      { sub: "u_1", iss: ORGANIZATION_ID, iat: nowSeconds(), exp: futureExp() },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token without an exp claim (exp is required)", async () => {
    const token = await signToken(
      {
        sub: "u_1",
        email: "test@example.com",
        name: "Ada",
        aud: ORGANIZATION_ID,
        iat: nowSeconds(),
      },
      SECRET
    );

    await expect(
      Effect.runPromise(verifyJwt(token, [SECRET], ORGANIZATION_ID))
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("rejects a token without an iat claim (iat is required)", async () => {
    const { iat: _iat, ...payloadWithoutIat } = basePayload();
    const token = await signToken(payloadWithoutIat, SECRET);

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

  it.effect("accepts a token expired within the clock-skew leeway", () =>
    Effect.gen(function* () {
      const now = nowSeconds();
      const token = yield* Effect.promise(() =>
        signToken(
          { ...basePayload(), iat: now - 60, exp: now - 5 },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID, {
        nowSeconds: now,
      });
      expect(payload.exp).toBe(now - 5);
    })
  );

  it("rejects a token with iat more than the clock-skew leeway in the future", async () => {
    const now = nowSeconds();
    const token = await signToken(
      { ...basePayload(), iat: now + CLOCK_SKEW_LEEWAY_SECONDS + 1 },
      SECRET
    );

    await expect(
      Effect.runPromise(
        verifyJwt(token, [SECRET], ORGANIZATION_ID, { nowSeconds: now })
      )
    ).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it.effect("accepts a token with iat within the clock-skew leeway", () =>
    Effect.gen(function* () {
      const now = nowSeconds();
      const token = yield* Effect.promise(() =>
        signToken(
          // Exactly at the boundary is accepted: only strictly beyond the
          // leeway is rejected.
          { ...basePayload(), iat: now + CLOCK_SKEW_LEEWAY_SECONDS },
          SECRET
        )
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID, {
        nowSeconds: now,
      });
      expect(payload.iat).toBe(now + CLOCK_SKEW_LEEWAY_SECONDS);
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

      expect(payload.sub).toBe("u_1");
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

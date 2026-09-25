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

const signTokenEffect = (payload: jose.JWTPayload, secret: string) =>
  Effect.promise(() => signToken(payload, secret));

describe("verifyJwt", () => {
  it.effect("verifies a token bound to the organization via aud with exp", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(basePayload(), SECRET);

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);

      expect(payload.sub).toBe("u_1");
      expect(payload.email).toBe("test@example.com");
      expect(payload.name).toBe("Ada");
    })
  );

  it.effect("rejects a token with the organization only in the iss claim", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(
        {
          sub: "u_1",
          iss: ORGANIZATION_ID,
          iat: nowSeconds(),
          exp: futureExp(),
        },
        SECRET
      );

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("rejects a token without an exp claim (exp is required)", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(
        {
          sub: "u_1",
          email: "test@example.com",
          name: "Ada",
          aud: ORGANIZATION_ID,
          iat: nowSeconds(),
        },
        SECRET
      );

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("rejects a token without an iat claim (iat is required)", () =>
    Effect.gen(function* () {
      const { iat: _iat, ...payloadWithoutIat } = basePayload();
      const token = yield* signTokenEffect(payloadWithoutIat, SECRET);

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect(
    "rejects a token expired relative to the pinned nowSeconds (seam drives jose)",
    () =>
      Effect.gen(function* () {
        // Valid at mint time, but the verification instant is pinned far enough
        // ahead that jose must judge it expired. Passes only if `currentDate` is
        // derived from options.nowSeconds rather than the wall clock.
        const now = nowSeconds();
        const token = yield* signTokenEffect(
          { ...basePayload(), iat: now, exp: now + 3600 },
          SECRET
        );

        const error = yield* Effect.flip(
          verifyJwt(token, [SECRET], ORGANIZATION_ID, {
            nowSeconds: now + 2 * 3600,
          })
        );
        expect(error).toBeInstanceOf(UnauthorizedError);
      })
  );

  it.effect("rejects an expired token when exp is present", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(
        { ...basePayload(), exp: pastExp() },
        SECRET
      );

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("accepts a token expired within the clock-skew leeway", () =>
    Effect.gen(function* () {
      const now = nowSeconds();
      const token = yield* signTokenEffect(
        { ...basePayload(), iat: now - 60, exp: now - 5 },
        SECRET
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID, {
        nowSeconds: now,
      });
      expect(payload.exp).toBe(now - 5);
    })
  );

  it.effect(
    "rejects a token with iat more than the clock-skew leeway in the future",
    () =>
      Effect.gen(function* () {
        const now = nowSeconds();
        const token = yield* signTokenEffect(
          { ...basePayload(), iat: now + CLOCK_SKEW_LEEWAY_SECONDS + 1 },
          SECRET
        );

        const error = yield* Effect.flip(
          verifyJwt(token, [SECRET], ORGANIZATION_ID, { nowSeconds: now })
        );
        expect(error).toBeInstanceOf(UnauthorizedError);
      })
  );

  it.effect("accepts a token with iat within the clock-skew leeway", () =>
    Effect.gen(function* () {
      const now = nowSeconds();
      const token = yield* signTokenEffect(
        // Exactly at the boundary is accepted: only strictly beyond the
        // leeway is rejected.
        { ...basePayload(), iat: now + CLOCK_SKEW_LEEWAY_SECONDS },
        SECRET
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID, {
        nowSeconds: now,
      });
      expect(payload.iat).toBe(now + CLOCK_SKEW_LEEWAY_SECONDS);
    })
  );

  it.effect("rejects a token with a lifetime beyond the 24h default cap", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(
        {
          ...basePayload(),
          iat: nowSeconds(),
          exp: nowSeconds() + 25 * 3600,
        },
        SECRET
      );

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("accepts a token with a lifetime within the default cap", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(
        {
          ...basePayload(),
          iat: nowSeconds(),
          exp: nowSeconds() + 23 * 3600,
        },
        SECRET
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);
      expect(payload.exp).toBeDefined();
    })
  );

  it.effect("respects a per-workspace maxTokenLifetime override", () =>
    Effect.gen(function* () {
      // 2-hour cap: a 3-hour token must be rejected even though the 24h
      // default would accept it.
      const token = yield* signTokenEffect(
        {
          ...basePayload(),
          iat: nowSeconds(),
          exp: nowSeconds() + 3 * 3600,
        },
        SECRET
      );

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID, {
          maxTokenLifetime: Duration.hours(2),
        })
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("accepts a token within a tightened per-workspace cap", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(
        { ...basePayload(), iat: nowSeconds(), exp: nowSeconds() + 3600 },
        SECRET
      );

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID, {
        maxTokenLifetime: Duration.hours(2),
      });
      expect(payload.exp).toBeDefined();
    })
  );

  it.effect("rejects a token bound to a different organization", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(
        { ...basePayload(), aud: "org_other" },
        SECRET
      );

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("rejects an unbound token (no aud claim)", () =>
    Effect.gen(function* () {
      const { aud: _aud, ...payloadWithoutAud } = basePayload();
      const token = yield* signTokenEffect(payloadWithoutAud, SECRET);

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("succeeds when at least one secret matches", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(basePayload(), OTHER_SECRET);

      const payload = yield* verifyJwt(
        token,
        [SECRET, OTHER_SECRET],
        ORGANIZATION_ID
      );

      expect(payload.sub).toBe("u_1");
    })
  );

  it.effect("fails when no secret matches", () =>
    Effect.gen(function* () {
      const token = yield* signTokenEffect(basePayload(), "c".repeat(64));

      const error = yield* Effect.flip(
        verifyJwt(token, [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("fails for a malformed token", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        verifyJwt("not-a-token", [SECRET], ORGANIZATION_ID)
      );
      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );
});

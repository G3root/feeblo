import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { TestClock } from "effect/testing";

import { UnauthorizedError } from "../rpc-errors";
import {
  WIDGET_IDENTITY_TOKEN_LIFETIME,
  signWidgetIdentityToken,
} from "./signing";
import { verifyJwt } from "./verification";

const SECRET = "a".repeat(64);
const OTHER_SECRET = "b".repeat(64);
const ORGANIZATION_ID = "org_test";

/** The instant these tests pin `TestClock` to, so claims are deterministic. */
const fixtureNow = new Date("2026-08-11T00:00:00.000Z");
const nowSeconds = () => Math.floor(fixtureNow.getTime() / 1000);

const claims = {
  email: "ada@example.com",
  issuer: "https://app.example.com",
  name: "Ada Lovelace",
  organizationId: ORGANIZATION_ID,
  subject: "usr_1",
};

const signToken = (secret: string) =>
  signWidgetIdentityToken({ ...claims, secret });

describe("signWidgetIdentityToken", () => {
  it.effect("mints a token the widget's verifier accepts", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixtureNow.getTime());
      const { token } = yield* signToken(SECRET);

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);

      expect(payload.sub).toBe(claims.subject);
      expect(payload.email).toBe(claims.email);
      expect(payload.name).toBe(claims.name);
      expect(payload.aud).toBe(ORGANIZATION_ID);
      expect(payload.iss).toBe(claims.issuer);
    })
  );

  it.effect("bounds the token by its own lifetime, not the workspace cap", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixtureNow.getTime());
      const { expiresAt, token } = yield* signToken(SECRET);

      const payload = yield* verifyJwt(token, [SECRET], ORGANIZATION_ID);

      expect(payload.iat).toBe(nowSeconds());
      expect(payload.exp).toBe(
        nowSeconds() + Duration.toSeconds(WIDGET_IDENTITY_TOKEN_LIFETIME)
      );
      expect(expiresAt.getTime()).toBe(
        fixtureNow.getTime() + Duration.toMillis(WIDGET_IDENTITY_TOKEN_LIFETIME)
      );
    })
  );

  it.effect("is bound to the audience it was minted for", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixtureNow.getTime());
      const { token } = yield* signToken(SECRET);

      const error = yield* Effect.flip(verifyJwt(token, [SECRET], "org_other"));

      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect("cannot be forged with another workspace's secret", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixtureNow.getTime());
      const { token } = yield* signToken(SECRET);

      const error = yield* Effect.flip(
        verifyJwt(token, [OTHER_SECRET], ORGANIZATION_ID)
      );

      expect(error).toBeInstanceOf(UnauthorizedError);
    })
  );

  it.effect(
    "still verifies while rotated secrets are in their grace window",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(fixtureNow.getTime());
        const { token } = yield* signToken(SECRET);

        // The repository returns the active secret first and the just-revoked
        // one second; the token minted with the retired secret keeps verifying.
        const payload = yield* verifyJwt(
          token,
          [OTHER_SECRET, SECRET],
          ORGANIZATION_ID
        );

        expect(payload.sub).toBe(claims.subject);
      })
  );
});

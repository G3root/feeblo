import { describe, expect, layer } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { NotificationPreferenceTokenService } from "./tokens";

const TestLayer = NotificationPreferenceTokenService.layerTest(
  "notification-preference-token-test-secret"
);

const claims = {
  category: "new_feedback" as const,
  organizationId: "org_token_test",
  userId: "user_token_test",
};

describe("NotificationPreferenceTokenService", () => {
  layer(TestLayer)("tokens", (it) => {
    it.effect("round-trips the unsubscribe claims", () =>
      Effect.gen(function* () {
        const tokens = yield* NotificationPreferenceTokenService;
        const token = yield* tokens.deriveToken(claims);
        const verified = yield* tokens.verifyToken(Redacted.value(token));

        expect(Option.getOrUndefined(verified)).toEqual(claims);
      })
    );

    it.effect("rejects a tampered signature", () =>
      Effect.gen(function* () {
        const tokens = yield* NotificationPreferenceTokenService;
        const token = yield* tokens.deriveToken(claims);
        const [payload, signature] = Redacted.value(token).split(".");
        if (payload === undefined || signature === undefined) {
          return yield* Effect.die("Expected a token payload and signature");
        }
        const verified = yield* tokens.verifyToken(
          `${payload}.${signature.slice(0, -1)}A`
        );

        expect(Option.isNone(verified)).toBe(true);
      })
    );

    it.effect("rejects a malformed token", () =>
      Effect.gen(function* () {
        const tokens = yield* NotificationPreferenceTokenService;
        const verified = yield* tokens.verifyToken("not-a-token");

        expect(Option.isNone(verified)).toBe(true);
      })
    );
  });
});

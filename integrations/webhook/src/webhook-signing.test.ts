import { it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { Webhook } from "standardwebhooks";
import { describe, expect } from "vitest";

import {
  rotateWebhookSigningKeyring,
  signWebhookDelivery,
} from "./webhook-signing";

describe("signWebhookDelivery", () => {
  it.effect("signs the exact raw body with a stable delivery ID", () =>
    Effect.gen(function* () {
      const now = new Date();
      const secret = Redacted.make(
        "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
      );
      const rawBody = '{"type":"feedback.post.created","title":"A  B"}';
      const headers = yield* signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: { current: secret },
        now,
        rawBody,
      });

      expect(headers["webhook-id"]).toBe("delivery_123");
      expect(headers["webhook-timestamp"]).toBe(
        String(Math.floor(now.getTime() / 1000))
      );
      expect(
        new Webhook(Redacted.value(secret)).verify(rawBody, headers)
      ).toEqual(
        yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
          rawBody
        )
      );
    })
  );

  it.effect(
    "emits both signatures only while the prior key is in its 24-hour rotation grace period",
    () =>
      Effect.gen(function* () {
        const now = new Date();
        const oldSecret = Redacted.make(
          "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
        );
        const rotated = yield* rotateWebhookSigningKeyring(
          { current: oldSecret },
          now
        );
        const rawBody = '{"type":"webhook.test"}';
        const duringGrace = yield* signWebhookDelivery({
          deliveryId: "delivery_123",
          keyring: rotated,
          now,
          rawBody,
        });
        const afterGrace = yield* signWebhookDelivery({
          deliveryId: "delivery_123",
          keyring: rotated,
          now: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          rawBody,
        });

        expect(duringGrace["webhook-signature"].split(" ")).toHaveLength(2);
        expect(
          new Webhook(Redacted.value(oldSecret)).verify(rawBody, duringGrace)
        ).toEqual(
          yield* Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Json))(
            rawBody
          )
        );
        expect(afterGrace["webhook-signature"].split(" ")).toHaveLength(1);
      })
  );
});

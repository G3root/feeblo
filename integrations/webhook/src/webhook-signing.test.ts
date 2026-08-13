import { describe, expect, it } from "@effect/vitest";
import { NodeCrypto } from "@effect/platform-node";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { TestClock } from "effect/testing";
import { Webhook } from "standardwebhooks";

import {
  rotateWebhookSigningKeyring,
  signWebhookDelivery,
} from "./webhook-signing";

const fixedNow = new Date();

describe("signWebhookDelivery", () => {
  it.effect("signs the exact raw body with a stable delivery ID", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixedNow.getTime());
      const secret = Redacted.make(
        "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
      );
      const rawBody = '{"type":"feedback.post.created","title":"A  B"}';
      const headers = yield* signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: { current: secret },
        rawBody,
      });

      expect(headers["webhook-id"]).toBe("delivery_123");
      expect(headers["webhook-timestamp"]).toBe(
        String(Math.floor(fixedNow.getTime() / 1000))
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
        yield* TestClock.setTime(fixedNow.getTime());
        const oldSecret = Redacted.make(
          "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
        );
        const rotated = yield* rotateWebhookSigningKeyring({
          current: oldSecret,
        });
        const rawBody = '{"type":"webhook.test"}';
        const duringGrace = yield* signWebhookDelivery({
          deliveryId: "delivery_123",
          keyring: rotated,
          rawBody,
        });
        yield* TestClock.adjust("24 hours");
        const afterGrace = yield* signWebhookDelivery({
          deliveryId: "delivery_123",
          keyring: rotated,
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
      }).pipe(Effect.provide(NodeCrypto.layer))
  );
});

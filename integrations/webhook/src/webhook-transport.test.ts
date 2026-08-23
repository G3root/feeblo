import type { LookupAddress } from "node:dns";

import { describe, expect, it } from "@effect/vitest";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { Webhook } from "standardwebhooks";

import { startTestServer } from "./test-server";
import { resolveAndParseWebhookEndpoint } from "./webhook-endpoint-security";
import { signWebhookDelivery } from "./webhook-signing";
import {
  makeWebhookPinnedLookup,
  parseWebhookRetryAfter,
  sendWebhookDelivery,
  WEBHOOK_MAX_PAYLOAD_BYTES,
  WEBHOOK_REQUEST_TIMEOUT_MS,
} from "./webhook-transport";

const firstHeaderValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

/** Fixed clock anchor for HTTP-date Retry-After deltas. */
const fixedNow = DateTime.fromDateUnsafe(new Date("2026-08-11T00:00:00.000Z"));

describe("makeWebhookPinnedLookup", () => {
  it("returns every pinned address in the autoSelectFamily `all` form", () => {
    const lookup = makeWebhookPinnedLookup([
      "2a01:4f8:121:114d::2",
      "178.63.67.153",
    ]);
    let captured: readonly LookupAddress[] | string | undefined;
    lookup("webhook.site", { all: true }, (error, result) => {
      expect(error).toBeNull();
      captured = result;
    });
    expect(captured).toEqual([
      { address: "2a01:4f8:121:114d::2", family: 6 },
      { address: "178.63.67.153", family: 4 },
    ]);
  });

  it("keeps the classic single-address form when `all` is not requested", () => {
    const lookup = makeWebhookPinnedLookup(["178.63.67.153"]);
    let captured:
      | { address: string | LookupAddress[]; family: number | undefined }
      | undefined;
    lookup("webhook.site", {}, (error, address, family) => {
      expect(error).toBeNull();
      captured = { address, family };
    });
    expect(captured).toEqual({ address: "178.63.67.153", family: 4 });
  });

  it("returns only IPv4 pinned addresses when family 4 is requested", () => {
    const lookup = makeWebhookPinnedLookup([
      "2a01:4f8:121:114d::2",
      "178.63.67.153",
    ]);
    let captured: readonly LookupAddress[] | string | undefined;
    lookup("webhook.site", { all: true, family: 4 }, (error, result) => {
      expect(error).toBeNull();
      captured = result;
    });
    expect(captured).toEqual([{ address: "178.63.67.153", family: 4 }]);
  });

  it("returns only IPv6 pinned addresses when family 6 is requested", () => {
    const lookup = makeWebhookPinnedLookup([
      "178.63.67.153",
      "2a01:4f8:121:114d::2",
    ]);
    let captured: readonly LookupAddress[] | string | undefined;
    lookup("webhook.site", { all: true, family: 6 }, (error, result) => {
      expect(error).toBeNull();
      captured = result;
    });
    expect(captured).toEqual([{ address: "2a01:4f8:121:114d::2", family: 6 }]);
  });

  it("skips a leading wrong-family address in the single-address form", () => {
    const lookup = makeWebhookPinnedLookup([
      "2a01:4f8:121:114d::2",
      "178.63.67.153",
    ]);
    let captured:
      | { address: string | LookupAddress[]; family: number | undefined }
      | undefined;
    lookup("webhook.site", { family: 4 }, (error, address, family) => {
      expect(error).toBeNull();
      captured = { address, family };
    });
    expect(captured).toEqual({ address: "178.63.67.153", family: 4 });
  });

  it("returns no addresses when no pinned address matches the family", () => {
    const lookup = makeWebhookPinnedLookup(["2a01:4f8:121:114d::2"]);
    let captured: readonly LookupAddress[] | string | undefined;
    lookup("webhook.site", { all: true, family: 4 }, (error, result) => {
      expect(error).toBeNull();
      captured = result;
    });
    expect(captured).toEqual([]);
  });
});

describe("parseWebhookRetryAfter", () => {
  it("returns no retry delay without a Retry-After header", () => {
    expect(parseWebhookRetryAfter(undefined, fixedNow)).toBeUndefined();
  });

  it("parses a seconds Retry-After", () => {
    expect(parseWebhookRetryAfter("120", fixedNow)).toEqual(
      Duration.seconds(120)
    );
  });

  it("parses a zero Retry-After as an immediate retry", () => {
    expect(parseWebhookRetryAfter("0", fixedNow)).toEqual(Duration.seconds(0));
  });

  it("caps a seconds Retry-After at one day", () => {
    expect(parseWebhookRetryAfter("90000", fixedNow)).toEqual(Duration.days(1));
  });

  it("ignores empty, malformed, and negative values", () => {
    expect(parseWebhookRetryAfter("", fixedNow)).toBeUndefined();
    expect(parseWebhookRetryAfter("0x10", fixedNow)).toBeUndefined();
    expect(parseWebhookRetryAfter("not-a-number", fixedNow)).toBeUndefined();
    expect(parseWebhookRetryAfter("-5", fixedNow)).toBeUndefined();
  });

  it("parses an HTTP-date Retry-After relative to the clock", () => {
    expect(
      parseWebhookRetryAfter("Tue, 11 Aug 2026 00:30:00 GMT", fixedNow)
    ).toEqual(Duration.seconds(1800));
  });

  it("clamps a past HTTP-date Retry-After to zero", () => {
    expect(
      parseWebhookRetryAfter("Mon, 10 Aug 2026 00:00:00 GMT", fixedNow)
    ).toEqual(Duration.seconds(0));
  });

  it("caps an HTTP-date Retry-After at one day", () => {
    expect(
      parseWebhookRetryAfter("Wed, 12 Aug 2026 00:00:00 GMT", fixedNow)
    ).toEqual(Duration.days(1));
  });
});

describe("sendWebhookDelivery", () => {
  it.live(
    "sends exact raw content and Standard Webhooks headers to a real local HTTP server",
    () =>
      Effect.gen(function* () {
        const secret = Redacted.make(
          "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
        );
        const rawBody = '{"type":"webhook.test","value":"exact  spacing"}';
        // The receiver captures the request facts and always completes with
        // 204; assertions run only after the delivery has settled so a failing
        // expectation cannot hang the request handler.
        let receiveRequest: (request: {
          readonly body: string;
          readonly headers: Record<string, string | string[] | undefined>;
        }) => void = () => undefined;
        const received = new Promise<{
          readonly body: string;
          readonly headers: Record<string, string | string[] | undefined>;
        }>((resolve) => {
          receiveRequest = resolve;
        });
        const endpointUrl = yield* startTestServer((request, response) => {
          const chunks: Buffer[] = [];
          request.on("data", (chunk: Buffer) => chunks.push(chunk));
          request.on("end", () => {
            receiveRequest({
              body: Buffer.concat(chunks).toString("utf8"),
              headers: request.headers,
            });
            response.writeHead(204).end();
          });
        });
        const endpoint = yield* resolveAndParseWebhookEndpoint(
          endpointUrl.toString(),
          {
            environment: "development",
            allowPrivateNetworkInDevelopment: true,
          }
        );
        const signingHeaders = yield* signWebhookDelivery({
          deliveryId: "delivery_123",
          keyring: { current: secret },
          rawBody,
        });
        const result = yield* sendWebhookDelivery({
          endpoint,
          eventType: "webhook.test",
          rawBody,
          signingHeaders,
        });
        expect(result).toEqual({ status: 204 });

        const request = yield* Effect.tryPromise(() => received);
        expect(request.body).toBe(rawBody);
        expect(request.headers["content-type"]).toBe("application/json");
        expect(request.headers["user-agent"]).toBe("Feeblo-Webhooks/1");
        expect(request.headers["x-feeblo-event"]).toBe("webhook.test");
        expect(
          new Webhook(Redacted.value(secret)).verify(rawBody, {
            "webhook-id": firstHeaderValue(request.headers["webhook-id"]),
            "webhook-timestamp": firstHeaderValue(
              request.headers["webhook-timestamp"]
            ),
            "webhook-signature": firstHeaderValue(
              request.headers["webhook-signature"]
            ),
          })
        ).toEqual({ type: "webhook.test", value: "exact  spacing" });
      })
  );

  it.live("reports a redirect response without following it", () =>
    Effect.gen(function* () {
      const endpointUrl = yield* startTestServer((_request, response) =>
        response.writeHead(302, { location: "http://127.0.0.1/other" }).end()
      );
      const endpoint = yield* resolveAndParseWebhookEndpoint(
        endpointUrl.toString(),
        {
          environment: "development",
          allowPrivateNetworkInDevelopment: true,
        }
      );
      const signingHeaders = yield* signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: {
          current: Redacted.make(
            "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
          ),
        },
        rawBody: "{}",
      });
      const result = yield* sendWebhookDelivery({
        endpoint,
        eventType: "webhook.test",
        rawBody: "{}",
        signingHeaders,
      });
      expect(result).toEqual({ status: 302 });
    })
  );

  it.live(
    "settles with a network failure when the receiver terminates the response early",
    () =>
      Effect.gen(function* () {
        const endpointUrl = yield* startTestServer((_request, response) => {
          response.writeHead(200);
          response.write("partial");
          response.destroy();
        });
        const endpoint = yield* resolveAndParseWebhookEndpoint(
          endpointUrl.toString(),
          {
            environment: "development",
            allowPrivateNetworkInDevelopment: true,
          }
        );
        const signingHeaders = yield* signWebhookDelivery({
          deliveryId: "delivery_123",
          keyring: {
            current: Redacted.make(
              "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
            ),
          },
          rawBody: "{}",
        });
        const failure = yield* Effect.flip(
          sendWebhookDelivery({
            endpoint,
            eventType: "webhook.test",
            rawBody: "{}",
            signingHeaders,
          })
        );
        expect(failure).toMatchObject({ kind: "network" });
        expect(failure.message).toBe(
          "WebhookTransportError: network failure while sending the webhook delivery"
        );
      })
  );

  it.effect("fails with a timeout when the receiver never responds", () =>
    Effect.gen(function* () {
      // Completes when the receiver has the request in hand, proving the
      // delivery's timeout race is armed before the clock advances.
      let markRequestArrived: () => void = () => undefined;
      const requestArrived = new Promise<void>((resolve) => {
        markRequestArrived = resolve;
      });
      const endpointUrl = yield* startTestServer(() => {
        // Never respond; the delivery must settle via WEBHOOK_REQUEST_TIMEOUT_MS.
        markRequestArrived();
      });
      const endpoint = yield* resolveAndParseWebhookEndpoint(
        endpointUrl.toString(),
        {
          environment: "development",
          allowPrivateNetworkInDevelopment: true,
        }
      );
      const signingHeaders = yield* signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: {
          current: Redacted.make(
            "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
          ),
        },
        rawBody: "{}",
      });
      // `it.effect` drives the clock with TestClock, so the delivery's timeout
      // race is armed on virtual time while the HTTP request itself runs for
      // real; advancing the clock interrupts the real socket.
      const failure = yield* Effect.gen(function* () {
        const delivery = yield* sendWebhookDelivery({
          endpoint,
          eventType: "webhook.test",
          rawBody: "{}",
          signingHeaders,
        }).pipe(Effect.flip, Effect.forkChild);
        yield* Effect.tryPromise(() => requestArrived);
        yield* TestClock.adjust(WEBHOOK_REQUEST_TIMEOUT_MS);
        return yield* Fiber.join(delivery);
      });
      expect(failure).toMatchObject({ kind: "timeout" });
      expect(failure.message).toBe(
        "WebhookTransportError: webhook delivery request timed out"
      );
    })
  );

  it.effect("rejects a payload beyond the limit before opening a request", () =>
    Effect.gen(function* () {
      const endpoint = {
        url: new URL("http://127.0.0.1:1/hook"),
        hostname: "127.0.0.1",
        pinnedAddresses: ["127.0.0.1"],
      };
      const failure = yield* Effect.flip(
        sendWebhookDelivery({
          endpoint,
          eventType: "webhook.test",
          rawBody: "x".repeat(WEBHOOK_MAX_PAYLOAD_BYTES + 1),
          signingHeaders: {
            "webhook-id": "delivery_123",
            "webhook-timestamp": "1",
            "webhook-signature": "v1,abc",
          },
        })
      );
      expect(failure).toMatchObject({ kind: "payload_too_large" });
      expect(failure.message).toBe(
        "WebhookTransportError: webhook payload exceeds the 256 KiB limit"
      );
    })
  );

  it.live("accepts a payload at exactly the limit", () =>
    Effect.gen(function* () {
      // The guard is strict, so an exactly-at-limit payload reaches the
      // (unreachable) pinned address and settles as a network failure.
      const failure = yield* Effect.flip(
        sendWebhookDelivery({
          endpoint: {
            url: new URL("http://127.0.0.1:1/hook"),
            hostname: "127.0.0.1",
            pinnedAddresses: ["127.0.0.1"],
          },
          eventType: "webhook.test",
          rawBody: "x".repeat(WEBHOOK_MAX_PAYLOAD_BYTES),
          signingHeaders: {
            "webhook-id": "delivery_123",
            "webhook-timestamp": "1",
            "webhook-signature": "v1,abc",
          },
        })
      );
      expect(failure).toMatchObject({ kind: "network" });
    })
  );
});

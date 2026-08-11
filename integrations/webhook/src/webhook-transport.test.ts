import * as http from "node:http";
import { afterEach, describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { Webhook } from "standardwebhooks";

import { resolveAndValidateWebhookEndpoint } from "./webhook-endpoint-security";
import { signWebhookDelivery } from "./webhook-signing";
import {
  classifyWebhookResponse,
  sendWebhookDelivery,
  WEBHOOK_MAX_PAYLOAD_BYTES,
  WEBHOOK_REQUEST_TIMEOUT_MS,
} from "./webhook-transport";

const servers: http.Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve) => server.close(() => resolve()))
      )
  );
});

const startServer = async (handler: http.RequestListener) => {
  const server = http.createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new TypeError("Expected TCP test server");
  }
  return `http://127.0.0.1:${address.port}/hook`;
};

const firstHeaderValue = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? (value[0] ?? "") : (value ?? "");

/** Fixed clock anchor for Retry-After delta assertions. */
const fixedNow = new Date("2026-08-11T00:00:00.000Z");

describe("classifyWebhookResponse", () => {
  it.effect("parses a seconds Retry-After", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixedNow.getTime());
      const response = yield* classifyWebhookResponse(429, "120");
      expect(response.retry).toBe(true);
      expect(response.retryAfter).toEqual(Duration.seconds(120));
    })
  );

  it.effect("parses an HTTP-date Retry-After against the clock", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixedNow.getTime());
      const response = yield* classifyWebhookResponse(
        429,
        "Wed, 12 Aug 2026 00:00:00 GMT"
      );
      expect(response.retry).toBe(true);
      expect(response.retryAfter).toEqual(Duration.days(1));
    })
  );

  it.effect("clamps a past HTTP-date Retry-After to zero", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixedNow.getTime());
      const response = yield* classifyWebhookResponse(
        429,
        "Mon, 10 Aug 2026 00:00:00 GMT"
      );
      expect(response.retry).toBe(true);
      expect(response.retryAfter).toEqual(Duration.seconds(0));
    })
  );

  it.effect("caps a seconds Retry-After at one day", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixedNow.getTime());
      const response = yield* classifyWebhookResponse(429, "90000");
      expect(response.retry).toBe(true);
      expect(response.retryAfter).toEqual(Duration.days(1));
    })
  );

  it.effect("ignores Retry-After on non-429 statuses", () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(fixedNow.getTime());
      const rateLimited = yield* classifyWebhookResponse(503, "120");
      expect(rateLimited).toMatchObject({ retry: true, status: 503 });
      const accepted = yield* classifyWebhookResponse(204, undefined);
      expect(accepted).toMatchObject({ retry: false, status: 204 });
    })
  );
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
        const endpointUrl = yield* Effect.tryPromise(() =>
          startServer((request, response) => {
            const chunks: Buffer[] = [];
            request.on("data", (chunk: Buffer) => chunks.push(chunk));
            request.on("end", () => {
              expect(Buffer.concat(chunks).toString("utf8")).toBe(rawBody);
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
              response.writeHead(204).end();
            });
          })
        );
        const endpoint = yield* resolveAndValidateWebhookEndpoint(endpointUrl, {
          environment: "development",
          allowPrivateNetworkInDevelopment: true,
        });
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
        expect(result).toMatchObject({ status: 204, retry: false });
      })
  );

  it.live(
    "does not follow redirects and classifies retryable receiver statuses",
    () =>
      Effect.gen(function* () {
        const endpointUrl = yield* Effect.tryPromise(() =>
          startServer((_request, response) =>
            response
              .writeHead(302, { location: "http://127.0.0.1/other" })
              .end()
          )
        );
        const endpoint = yield* resolveAndValidateWebhookEndpoint(endpointUrl, {
          environment: "development",
          allowPrivateNetworkInDevelopment: true,
        });
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
        expect(result).toMatchObject({ status: 302, retry: false });
        // Seconds-form Retry-After is clock-independent; classification stays observable here.
        const rateLimited = yield* classifyWebhookResponse(429, "120");
        expect(rateLimited.retry).toBe(true);
        expect(rateLimited.retryAfter).toEqual(Duration.seconds(120));
        const retryable = yield* classifyWebhookResponse(503, undefined);
        expect(retryable.retry).toBe(true);
      })
  );

  it.live(
    "settles with a network failure when the receiver terminates the response early",
    () =>
      Effect.gen(function* () {
        const endpointUrl = yield* Effect.tryPromise(() =>
          startServer((_request, response) => {
            response.writeHead(200);
            response.write("partial");
            response.socket!.destroy();
          })
        );
        const endpoint = yield* resolveAndValidateWebhookEndpoint(endpointUrl, {
          environment: "development",
          allowPrivateNetworkInDevelopment: true,
        });
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
      })
  );

  it.live("fails with a timeout when the receiver never responds", () =>
    Effect.gen(function* () {
      const endpointUrl = yield* Effect.tryPromise(() =>
        startServer(() => {
          // Never respond; the delivery must settle via WEBHOOK_REQUEST_TIMEOUT_MS.
        })
      );
      const endpoint = yield* resolveAndValidateWebhookEndpoint(endpointUrl, {
        environment: "development",
        allowPrivateNetworkInDevelopment: true,
      });
      const signingHeaders = yield* signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: {
          current: Redacted.make(
            "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
          ),
        },
        rawBody: "{}",
      });
      // Fire the deadline on the test clock; the interrupt destroys the real socket.
      const failure = yield* Effect.gen(function* () {
        const delivery = yield* sendWebhookDelivery({
          endpoint,
          eventType: "webhook.test",
          rawBody: "{}",
          signingHeaders,
        }).pipe(Effect.flip, Effect.forkChild);
        // Let the delivery arm its timeout race before advancing the clock.
        yield* Effect.yieldNow;
        yield* TestClock.adjust(WEBHOOK_REQUEST_TIMEOUT_MS);
        return yield* Fiber.join(delivery);
      }).pipe(Effect.provide(TestClock.layer()));
      expect(failure).toMatchObject({ kind: "timeout" });
    })
  );

  it.effect("rejects a payload before opening a request", () =>
    Effect.gen(function* () {
      const endpoint = {
        url: new URL("http://127.0.0.1:1/hook"),
        hostname: "127.0.0.1",
        pinnedAddresses: ["127.0.0.1"],
      };
      const exit = yield* Effect.exit(
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
      expect(exit._tag).toBe("Failure");
    })
  );
});

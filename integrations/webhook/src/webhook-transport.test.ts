import * as http from "node:http";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Redacted from "effect/Redacted";
import { TestClock } from "effect/testing";
import { Webhook } from "standardwebhooks";
import { afterEach, describe, expect, it } from "vitest";

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

/** Runs the classifier with a fixed test-clock time so Retry-After deltas are deterministic. */
const classifyWithTestClock = (
  status: number,
  retryAfter: string | undefined
) =>
  Effect.runPromise(
    Effect.provide(
      TestClock.setTime(new Date("2026-08-11T00:00:00.000Z").getTime()).pipe(
        Effect.flatMap(() => classifyWebhookResponse(status, retryAfter))
      ),
      TestClock.layer()
    )
  );

describe("classifyWebhookResponse", () => {
  it("parses a seconds Retry-After", async () => {
    await expect(classifyWithTestClock(429, "120")).resolves.toMatchObject({
      retry: true,
      retryAfter: Duration.seconds(120),
    });
  });

  it("parses an HTTP-date Retry-After against the clock", async () => {
    await expect(
      classifyWithTestClock(429, "Wed, 12 Aug 2026 00:00:00 GMT")
    ).resolves.toMatchObject({ retry: true, retryAfter: Duration.days(1) });
  });

  it("clamps a past HTTP-date Retry-After to zero", async () => {
    await expect(
      classifyWithTestClock(429, "Mon, 10 Aug 2026 00:00:00 GMT")
    ).resolves.toMatchObject({ retry: true, retryAfter: Duration.seconds(0) });
  });

  it("caps a seconds Retry-After at one day", async () => {
    await expect(classifyWithTestClock(429, "90000")).resolves.toMatchObject({
      retry: true,
      retryAfter: Duration.days(1),
    });
  });

  it("ignores Retry-After on non-429 statuses", async () => {
    await expect(classifyWithTestClock(503, "120")).resolves.toMatchObject({
      retry: true,
      status: 503,
    });
    await expect(classifyWithTestClock(204, undefined)).resolves.toMatchObject({
      retry: false,
      status: 204,
    });
  });
});

describe("sendWebhookDelivery", () => {
  it("sends exact raw content and Standard Webhooks headers to a real local HTTP server", async () => {
    const secret = Redacted.make(
      "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
    );
    const rawBody = '{"type":"webhook.test","value":"exact  spacing"}';
    const endpointUrl = await startServer((request, response) => {
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
    });
    const endpoint = await Effect.runPromise(
      resolveAndValidateWebhookEndpoint(endpointUrl, {
        environment: "development",
        allowPrivateNetworkInDevelopment: true,
      })
    );
    const signingHeaders = await Effect.runPromise(
      signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: { current: secret },
        rawBody,
      })
    );
    await expect(
      Effect.runPromise(
        sendWebhookDelivery({
          endpoint,
          eventType: "webhook.test",
          rawBody,
          signingHeaders,
        })
      )
    ).resolves.toMatchObject({ status: 204, retry: false });
  });

  it("does not follow redirects and classifies retryable receiver statuses", async () => {
    const endpointUrl = await startServer((_request, response) =>
      response.writeHead(302, { location: "http://127.0.0.1/other" }).end()
    );
    const endpoint = await Effect.runPromise(
      resolveAndValidateWebhookEndpoint(endpointUrl, {
        environment: "development",
        allowPrivateNetworkInDevelopment: true,
      })
    );
    const signingHeaders = await Effect.runPromise(
      signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: {
          current: Redacted.make(
            "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
          ),
        },
        rawBody: "{}",
      })
    );
    await expect(
      Effect.runPromise(
        sendWebhookDelivery({
          endpoint,
          eventType: "webhook.test",
          rawBody: "{}",
          signingHeaders,
        })
      )
    ).resolves.toMatchObject({ status: 302, retry: false });
    await expect(classifyWithTestClock(429, "120")).resolves.toMatchObject({
      retry: true,
      retryAfter: Duration.seconds(120),
    });
    await expect(classifyWithTestClock(503, undefined)).resolves.toMatchObject({
      retry: true,
    });
  });

  it("settles with a network failure when the receiver terminates the response early", async () => {
    const endpointUrl = await startServer((_request, response) => {
      response.writeHead(200);
      response.write("partial");
      response.socket!.destroy();
    });
    const endpoint = await Effect.runPromise(
      resolveAndValidateWebhookEndpoint(endpointUrl, {
        environment: "development",
        allowPrivateNetworkInDevelopment: true,
      })
    );
    const signingHeaders = await Effect.runPromise(
      signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: {
          current: Redacted.make(
            "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
          ),
        },
        rawBody: "{}",
      })
    );
    await expect(
      Effect.runPromise(
        sendWebhookDelivery({
          endpoint,
          eventType: "webhook.test",
          rawBody: "{}",
          signingHeaders,
        })
      )
    ).rejects.toMatchObject({ kind: "network" });
  });

  it("fails with a timeout when the receiver never responds", async () => {
    const endpointUrl = await startServer(() => {
      // Never respond; the delivery must settle via WEBHOOK_REQUEST_TIMEOUT_MS.
    });
    const endpoint = await Effect.runPromise(
      resolveAndValidateWebhookEndpoint(endpointUrl, {
        environment: "development",
        allowPrivateNetworkInDevelopment: true,
      })
    );
    const signingHeaders = await Effect.runPromise(
      signWebhookDelivery({
        deliveryId: "delivery_123",
        keyring: {
          current: Redacted.make(
            "whsec_MTIzNDU2Nzg5MDEyMzQ1Njc4OTAxMjM0NTY3ODkwMTI="
          ),
        },
        rawBody: "{}",
      })
    );
    // Fire the deadline on the test clock; the interrupt destroys the real socket.
    const failure = await Effect.runPromise(
      Effect.gen(function* () {
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
      }).pipe(Effect.provide(TestClock.layer()))
    );
    expect(failure).toMatchObject({ kind: "timeout" });
  });

  it("rejects a payload before opening a request", async () => {
    const endpoint = {
      url: new URL("http://127.0.0.1:1/hook"),
      hostname: "127.0.0.1",
      pinnedAddresses: ["127.0.0.1"],
    };
    const error = await Effect.runPromiseExit(
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
    expect(error._tag).toBe("Failure");
  });
});

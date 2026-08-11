import * as http from "node:http";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import { Webhook } from "standardwebhooks";
import { afterEach, describe, expect, it } from "vitest";

import { resolveAndValidateWebhookEndpoint } from "./webhook-endpoint-security";
import { signWebhookDelivery } from "./webhook-signing";
import {
  classifyWebhookResponse,
  sendWebhookDelivery,
  WEBHOOK_MAX_PAYLOAD_BYTES,
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
    const now = new Date("2026-08-11T00:00:00.000Z");
    expect(classifyWebhookResponse(429, "120", now)).toMatchObject({
      retry: true,
      retryAfterSeconds: 120,
    });
    expect(classifyWebhookResponse(503, undefined, now).retry).toBe(true);
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

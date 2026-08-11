import * as http from "node:http";
import * as https from "node:https";
import { isIP, type LookupFunction } from "node:net";

import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import type { ValidatedWebhookEndpoint } from "./webhook-endpoint-security";
import { WebhookTransportError } from "./webhook-errors";
import type { WebhookSigningHeaders } from "./webhook-signing";

/** Maximum outbound webhook payload bytes, enforced before a socket can be opened. */
export const WEBHOOK_MAX_PAYLOAD_BYTES = 256 * 1024;
/** Maximum outbound webhook request duration. */
export const WEBHOOK_REQUEST_TIMEOUT_MS = 10_000;

/** Safe outbound response data persisted by the delivery kernel. Response bodies are never retained. */
export interface WebhookDeliveryResponse {
  readonly retry: boolean;
  readonly retryAfterSeconds?: number;
  readonly status: number;
}

/** Bounded Retry-After parser: accepts seconds and caps a receiver request at one day. */
export const parseWebhookRetryAfterSeconds = (
  value: string | undefined,
  now: Date
): number | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isSafeInteger(seconds) && seconds >= 0) {
    return Math.min(seconds, 24 * 60 * 60);
  }
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }
  const delta = Math.ceil((retryAt - now.getTime()) / 1000);
  return delta < 0 ? 0 : Math.min(delta, 24 * 60 * 60);
};

/** Classifies HTTP status codes according to the durable webhook retry policy. */
export const classifyWebhookResponse = (
  status: number,
  retryAfter: string | undefined,
  now: Date
): WebhookDeliveryResponse => {
  const retry =
    status === 408 ||
    status === 409 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599);
  const retryAfterSeconds =
    status === 429
      ? parseWebhookRetryAfterSeconds(retryAfter, now)
      : undefined;
  return retryAfterSeconds === undefined
    ? { status, retry }
    : { status, retry, retryAfterSeconds };
};

/** Sends a signed raw JSON body through a pinned DNS lookup, with redirects disabled and no response body retention. */
export const sendWebhookDelivery = ({
  endpoint,
  eventType,
  rawBody,
  signingHeaders,
}: {
  readonly endpoint: ValidatedWebhookEndpoint;
  readonly eventType: string;
  readonly rawBody: string;
  readonly signingHeaders: WebhookSigningHeaders;
}): Effect.Effect<WebhookDeliveryResponse, WebhookTransportError> => {
  const contentLength = Buffer.byteLength(rawBody, "utf8");
  if (contentLength > WEBHOOK_MAX_PAYLOAD_BYTES) {
    return Effect.fail(
      new WebhookTransportError({ kind: "payload_too_large" })
    );
  }
  const pinnedAddress = endpoint.pinnedAddresses[0];
  if (pinnedAddress === undefined) {
    return Effect.fail(new WebhookTransportError({ kind: "network" }));
  }

  return Effect.callback((resume, signal) => {
    const transport = endpoint.url.protocol === "https:" ? https : http;
    const lookupPinnedAddress: LookupFunction = (
      _hostname,
      _options,
      callback
    ) => {
      callback(null, pinnedAddress, isIP(pinnedAddress));
    };
    const agent = new transport.Agent({ keepAlive: false });
    let settled = false;
    const finish = (
      effect: Effect.Effect<WebhookDeliveryResponse, WebhookTransportError>
    ) => {
      if (!settled) {
        settled = true;
        clearTimeout(deadline);
        resume(effect);
      }
    };
    const request = transport.request(
      {
        protocol: endpoint.url.protocol,
        hostname: endpoint.hostname,
        ...(endpoint.url.port === "" ? {} : { port: endpoint.url.port }),
        path: `${endpoint.url.pathname}${endpoint.url.search}`,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(contentLength),
          "user-agent": "Feeblo-Webhooks/1",
          "x-feeblo-event": eventType,
          ...signingHeaders,
        },
        agent,
        lookup: lookupPinnedAddress,
      },
      (response) => {
        response.resume();
        response.on("end", () => {
          const retryAfter = response.headers["retry-after"];
          finish(
            DateTime.nowAsDate.pipe(
              Effect.map((now) =>
                classifyWebhookResponse(
                  response.statusCode ?? 0,
                  Array.isArray(retryAfter) ? retryAfter[0] : retryAfter,
                  now
                )
              )
            )
          );
        });
        response.on("aborted", () =>
          finish(Effect.fail(new WebhookTransportError({ kind: "network" })))
        );
        response.on("error", () =>
          finish(Effect.fail(new WebhookTransportError({ kind: "network" })))
        );
      }
    );
    const deadline = setTimeout(() => {
      request.destroy();
      finish(Effect.fail(new WebhookTransportError({ kind: "timeout" })));
    }, WEBHOOK_REQUEST_TIMEOUT_MS);
    request.on("error", () =>
      finish(Effect.fail(new WebhookTransportError({ kind: "network" })))
    );
    signal.addEventListener("abort", () => request.destroy(), { once: true });
    request.end(rawBody, "utf8");
  });
};

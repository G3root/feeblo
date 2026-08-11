import { NodeHttpClient } from "@effect/platform-node";
import { isIP, type LookupFunction } from "node:net";

import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Headers from "effect/unstable/http/Headers";
import * as HttpBody from "effect/unstable/http/HttpBody";
import * as HttpClient from "effect/unstable/http/HttpClient";

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
  readonly retryAfter?: Duration.Duration;
  readonly status: number;
}

/** Bounded Retry-After parser: accepts seconds and caps a receiver request at one day. */
export const parseWebhookRetryAfter = (
  value: string | undefined,
  now: DateTime.DateTime
): Duration.Duration | undefined => {
  if (value === undefined) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isSafeInteger(seconds) && seconds >= 0) {
    return Duration.min(Duration.seconds(seconds), Duration.days(1));
  }
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }
  const delta = Math.ceil((retryAt - now.epochMilliseconds) / 1000);
  return Duration.min(Duration.seconds(Math.max(0, delta)), Duration.days(1));
};

/** Classifies HTTP status codes according to the durable webhook retry policy; the clock (and thus TestClock) drives Retry-After deltas. */
export const classifyWebhookResponse = (
  status: number,
  retryAfter: string | undefined
): Effect.Effect<WebhookDeliveryResponse> =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const retryAfterDuration =
      status === 429 ? parseWebhookRetryAfter(retryAfter, now) : undefined;
    const retry =
      status === 408 ||
      status === 409 ||
      status === 425 ||
      status === 429 ||
      (status >= 500 && status <= 599);
    return retryAfterDuration === undefined
      ? { status, retry }
      : { status, retry, retryAfter: retryAfterDuration };
  });

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
      new WebhookTransportError({
        kind: "payload_too_large",
        message: "WebhookTransportError: webhook payload exceeds the 256 KiB limit",
      })
    );
  }
  const pinnedAddress = endpoint.pinnedAddresses[0];
  if (pinnedAddress === undefined) {
    return Effect.fail(
      new WebhookTransportError({
        kind: "network",
        message:
          "WebhookTransportError: network failure while sending the webhook delivery",
      })
    );
  }

  const pinnedLookup: LookupFunction = (_hostname, _options, callback) => {
    callback(null, pinnedAddress, isIP(pinnedAddress));
  };
  const networkFailure = () =>
    new WebhookTransportError({
      kind: "network",
      message:
        "WebhookTransportError: network failure while sending the webhook delivery",
    });

  return Effect.scoped(
    Effect.gen(function* () {
      // One-off agent pinned to the validated address; released with the scope.
      const agent = yield* NodeHttpClient.makeAgent({
        keepAlive: false,
        lookup: pinnedLookup,
      });
      const client = yield* NodeHttpClient.makeNodeHttp.pipe(
        Effect.provideService(NodeHttpClient.HttpAgent, agent)
      );

      const response = yield* HttpClient.post(endpoint.url, {
        headers: {
          "content-type": "application/json",
          "user-agent": "Feeblo-Webhooks/1",
          "x-feeblo-event": eventType,
          ...signingHeaders,
        },
        body: HttpBody.text(rawBody),
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.mapError(networkFailure)
      );

      // Drain the body without retaining it; a truncated body is a network failure.
      yield* response.stream.pipe(
        Stream.runDrain,
        Effect.mapError(networkFailure)
      );

      return yield* classifyWebhookResponse(
        response.status,
        Option.getOrUndefined(Headers.get(response.headers, "retry-after"))
      );
    })
  ).pipe(
    Effect.timeout(WEBHOOK_REQUEST_TIMEOUT_MS),
    Effect.catchTag(
      "TimeoutError",
      () =>
        new WebhookTransportError({
          kind: "timeout",
          message: "WebhookTransportError: webhook delivery request timed out",
        })
    )
  );
};

import { isIP, type LookupFunction } from "node:net";
import { NodeHttpClient } from "@effect/platform-node";

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

/**
 * Raw receiver response facts for the delivery kernel; response bodies are never retained.
 * Retry classification of statuses is owned by the kernel's delivery policy, not by transport.
 */
export interface WebhookDeliveryResponse {
  /** Bounded Retry-After delay, present only when the receiver asked for a backoff. */
  readonly retryAfter?: Duration.Duration;
  /** HTTP status received from the receiver. */
  readonly status: number;
}

/** RFC 7231 IMF-fixdate shape; guards `Date.parse` from misreading values like "-5" as calendar years. */
const httpDatePattern =
  /^[A-Za-z]{3}, \d{1,2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/;

/** RFC 7231 delay-seconds grammar: one or more ASCII digits. */
const delaySecondsPattern = /^[0-9]+$/;

/** Bounded Retry-After parser: accepts delay-seconds or HTTP dates, and caps a receiver request at one day. */
export const parseWebhookRetryAfter = (
  value: string | undefined,
  now: DateTime.DateTime
): Duration.Duration | undefined => {
  if (value === undefined) {
    return undefined;
  }
  // Number() alone would accept empty, hexadecimal, exponent, and sign forms;
  // RFC 7231 only permits plain nonnegative decimal digits here.
  const seconds = delaySecondsPattern.test(value) ? Number(value) : undefined;
  if (seconds !== undefined && Number.isSafeInteger(seconds)) {
    return Duration.min(Duration.seconds(seconds), Duration.days(1));
  }
  if (!httpDatePattern.test(value)) {
    return undefined;
  }
  const retryAt = Date.parse(value);
  if (Number.isNaN(retryAt)) {
    return undefined;
  }
  const delta = Math.ceil((retryAt - now.epochMilliseconds) / 1000);
  return Duration.min(Duration.seconds(Math.max(0, delta)), Duration.days(1));
};

/** LookupOptions.family legacy string labels, normalized to their numeric forms. */
const familyLabelToNumber: Record<"IPv4" | "IPv6", 4 | 6> = {
  IPv4: 4,
  IPv6: 6,
};

/**
 * Builds the DNS pin for a validated endpoint. Node 20+ (where
 * `autoSelectFamily` is the default) invokes the lookup with `all: true` and
 * expects the address-list form; returning every pinned address there also
 * lets happy-eyeballs skip an unreachable first family (for example IPv6 on
 * an IPv4-only host). The classic single-address form is kept for older
 * paths that pass `all: false`. When the caller requests a specific record
 * family (`options.family` of 4 or 6), only pinned addresses of that family
 * are returned; family 0 or an unspecified family keeps every pinned
 * address.
 */
export const makeWebhookPinnedLookup =
  (pinnedAddresses: readonly string[]): LookupFunction =>
  (_hostname, options, callback) => {
    const requestedFamily =
      typeof options.family === "string"
        ? familyLabelToNumber[options.family]
        : options.family;
    const matchingAddresses = pinnedAddresses.filter(
      (address) =>
        requestedFamily === undefined ||
        requestedFamily === 0 ||
        isIP(address) === requestedFamily
    );
    if (options.all === true) {
      callback(
        null,
        matchingAddresses.map((address) => ({
          address,
          family: isIP(address),
        }))
      );
      return;
    }
    const pinnedAddress = matchingAddresses[0];
    if (pinnedAddress === undefined) {
      callback(null, []);
      return;
    }
    callback(null, pinnedAddress, isIP(pinnedAddress));
  };

/**
 * Sends a signed raw JSON body through a pinned DNS lookup, with redirects disabled and no
 * response body retention.
 *
 * @returns The raw receiver status and any bounded Retry-After; fails with `WebhookTransportError`
 * for oversized payloads, network failures, and request timeouts.
 */
export const sendWebhookDelivery = Effect.fn(
  "WebhookTransport.sendWebhookDelivery"
)(function* ({
  endpoint,
  eventType,
  rawBody,
  signingHeaders,
}: {
  readonly endpoint: ValidatedWebhookEndpoint;
  readonly eventType: string;
  readonly rawBody: string;
  readonly signingHeaders: WebhookSigningHeaders;
}) {
  const contentLength = Buffer.byteLength(rawBody, "utf8");
  if (contentLength > WEBHOOK_MAX_PAYLOAD_BYTES) {
    return yield* new WebhookTransportError({
      kind: "payload_too_large",
      message:
        "WebhookTransportError: webhook payload exceeds the 256 KiB limit",
    });
  }
  // The client error cause is intentionally dropped when mapping transport
  // failures: it can carry the endpoint URL and request metadata that must
  // stay out of persisted and logged failures.
  const networkFailure = () =>
    new WebhookTransportError({
      kind: "network",
      message:
        "WebhookTransportError: network failure while sending the webhook delivery",
    });
  const pinnedAddress = endpoint.pinnedAddresses[0];
  if (pinnedAddress === undefined) {
    return yield* networkFailure();
  }

  const pinnedLookup = makeWebhookPinnedLookup(endpoint.pinnedAddresses);

  return yield* Effect.scoped(
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
          "user-agent": "Feeblo-Webhooks/1",
          "x-feeblo-event": eventType,
          ...signingHeaders,
        },
        // The explicit content type belongs on the body: HttpClientRequest's
        // setBody overrides any content-type header with the body's own
        // metadata, so HttpBody.text without a type would downgrade the
        // request to text/plain.
        body: HttpBody.text(rawBody, "application/json"),
      }).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.mapError(networkFailure)
      );

      // Drain the body without retaining it; a truncated body is a network failure.
      yield* response.stream.pipe(
        Stream.runDrain,
        Effect.mapError(networkFailure)
      );

      const now = yield* DateTime.now;
      const retryAfterHeader = Option.getOrUndefined(
        Headers.get(response.headers, "retry-after")
      );
      // Parse before the spread so an invalid header value (or an absent one)
      // never materializes an explicit `retryAfter: undefined` key.
      const retryAfter =
        retryAfterHeader === undefined
          ? undefined
          : parseWebhookRetryAfter(retryAfterHeader, now);
      return {
        status: response.status,
        ...(retryAfter === undefined ? {} : { retryAfter }),
      };
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
});

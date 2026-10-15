/**
 * The telemetry exporters' HTTP client.
 *
 * Effect's OTLP exporter retries transient failures but applies no per-request
 * timeout, and it does not account for a collector that answers with an OTLP
 * partial-success acknowledgement. This client bounds each export, records
 * transport and acknowledgement failures on the metric registry, and releases
 * the response body inside the export scope.
 *
 * `Layer.fresh` keeps this client's memo map separate from product HTTP: an
 * export-only `RequestInit` must never reach a client that serves requests.
 * Ported from `UsefulSoftwareCo/executor`'s
 * `packages/telemetry/src/transport.ts`.
 */
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";
import * as Effect from "effect/Effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientError,
  type HttpClientResponse,
} from "effect/http";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { telemetryRequestTimeout } from "./config";
import { recordExportFailure } from "./measurements";

const Count = Schema.Union([Schema.Finite, Schema.FiniteFromString]).check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)
);

const Acknowledgement = Schema.Struct({
  partialSuccess: Schema.optional(
    Schema.Struct({
      rejectedSpans: Schema.optional(Count),
      rejectedLogRecords: Schema.optional(Count),
      rejectedDataPoints: Schema.optional(Count),
      errorMessage: Schema.optional(Schema.String),
    })
  ),
});

// Export{Trace,Logs,Metrics}ServiceResponse all have partial_success at field 1.
// Its field 1 is the rejected int64 count and field 2 is a diagnostic string.
// The maintained wire reader owns bounds, integer decoding and unknown fields.
const protobufAcknowledgement = (bytes: Uint8Array) => {
  const reader = new BinaryReader(bytes);
  let rejected = "0";
  let message = "";
  while (reader.pos < reader.len) {
    const [field, wire] = reader.tag();
    if (field !== 1 || wire !== WireType.LengthDelimited) {
      reader.skip(wire, field);
      continue;
    }
    const partial = new BinaryReader(reader.bytes());
    while (partial.pos < partial.len) {
      const [innerField, innerWire] = partial.tag();
      if (innerField === 1 && innerWire === WireType.Varint) {
        rejected = String(partial.int64());
      } else if (innerField === 2 && innerWire === WireType.LengthDelimited) {
        message = partial.string();
      } else {
        partial.skip(innerWire, innerField);
      }
    }
  }
  return {
    partialSuccess: { rejectedDataPoints: rejected, errorMessage: message },
  };
};

const decodeError = (
  request: HttpClientResponse.HttpClientResponse["request"],
  response: HttpClientResponse.HttpClientResponse
) =>
  new HttpClientError.HttpClientError({
    reason: new HttpClientError.DecodeError({
      request,
      response,
      description: "Invalid OTLP acknowledgement",
    }),
  });

/** The sentinel the acknowledgement timeout fails with, classified apart from transport errors. */
const acknowledgementTimeout = "Telemetry collector acknowledgement timed out";

/** Classify an export failure for the `reason` label on the failure counter. */
const exportFailureReason = (
  cause: unknown
): "acknowledgement" | "timeout" | "transport" => {
  if (!HttpClientError.isHttpClientError(cause)) {
    return "transport";
  }
  if (cause.reason._tag === "DecodeError") {
    return "acknowledgement";
  }
  if (
    cause.reason._tag === "TransportError" &&
    cause.reason.description === acknowledgementTimeout
  ) {
    return "timeout";
  }
  return "transport";
};

const decodeAcknowledgement = (
  response: HttpClientResponse.HttpClientResponse
) =>
  Effect.gen(function* () {
    const bytes = new Uint8Array(yield* response.arrayBuffer);
    if (bytes.byteLength === 0) {
      return undefined;
    }
    const failed = () => decodeError(response.request, response);
    if (response.headers["content-type"]?.includes("application/x-protobuf")) {
      return yield* Schema.decodeEffect(Acknowledgement)(
        protobufAcknowledgement(bytes)
      ).pipe(Effect.mapError(failed));
    }
    return yield* Schema.decodeEffect(Schema.fromJsonString(Acknowledgement))(
      new TextDecoder().decode(bytes)
    ).pipe(Effect.mapError(failed));
  });

const acknowledge = (response: HttpClientResponse.HttpClientResponse) =>
  Effect.gen(function* () {
    const acknowledgement = yield* decodeAcknowledgement(response);
    const partial = acknowledgement?.partialSuccess;
    if (partial === undefined) {
      return;
    }
    const rejected =
      (partial.rejectedSpans ?? 0) +
      (partial.rejectedLogRecords ?? 0) +
      (partial.rejectedDataPoints ?? 0);
    // OTLP prohibits retrying partial success. Account for it without resending
    // accepted records, and never log a collector's potentially sensitive body.
    if (rejected > 0 || partial.errorMessage) {
      yield* recordExportFailure(
        new URL(response.request.url).pathname,
        "partial-success",
        rejected
      );
    }
  });

/** Telemetry consumers inspect status and headers; release response I/O inside each export scope. */
export const telemetryHttpClient: Layer.Layer<HttpClient.HttpClient> =
  Layer.effect(
    HttpClient.HttpClient,
    HttpClient.HttpClient.pipe(
      Effect.map((client) =>
        client.pipe(
          HttpClient.filterStatusOk,
          HttpClient.transform((response, request) =>
            response.pipe(
              Effect.tap(acknowledge),
              Effect.timeoutOrElse({
                duration: telemetryRequestTimeout,
                orElse: () =>
                  Effect.fail(
                    new HttpClientError.HttpClientError({
                      reason: new HttpClientError.TransportError({
                        request,
                        description: acknowledgementTimeout,
                      }),
                    })
                  ),
              }),
              Effect.tapError((error) =>
                recordExportFailure(
                  new URL(request.url).pathname,
                  exportFailureReason(error)
                )
              ),
              Effect.onInterrupt(() =>
                recordExportFailure(
                  new URL(request.url).pathname,
                  "interrupted"
                )
              )
            )
          ),
          HttpClient.withScope,
          HttpClient.transformResponse(Effect.scoped)
        )
      )
    )
  ).pipe(Layer.provide(Layer.fresh(FetchHttpClient.layer)));

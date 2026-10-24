/**
 * Same-origin relay for browser telemetry.
 *
 * The browser's Effect OTLP exporters post JSON to this server, which forwards
 * the batch to the host's configured OTLP destination. Collector URLs and
 * credentials stay in the server environment; nothing about the backend leaves
 * the process.
 *
 * This is the browser half of the split `apps/server/src/infra/telemetry`
 * serves: Sentry reports errors, OTLP reports traces. Ported from
 * `UsefulSoftwareCo/executor`'s `packages/telemetry/src/http.ts`.
 *
 * The route is unauthenticated by design, like the browser's own Sentry
 * tunnel: a page may fail before it has a session. The global origin-check
 * middleware still rejects a state-changing request from an untrusted origin,
 * the body is capped, and the relay holds no credential the caller can read.
 */
import * as ByteSize from "effect/ByteSize";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpBody from "effect/http/HttpBody";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";
import * as HttpRouter from "effect/http/HttpRouter";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

import type { TelemetryTarget } from "../infra/telemetry/config";
import {
  telemetryConfig,
  telemetryRequestTimeout,
} from "../infra/telemetry/config";

/** Browser batches are one buffered second of spans or logs. */
const maxBodyBytes = 256 * 1024;
const maxBodySize = ByteSize.bytes(maxBodyBytes);
/** One buffered second cannot legitimately carry more than this. */
const maxRecords = 1_000;

const empty = (status: number) => HttpServerResponse.empty({ status });

/**
 * The identity every forwarded browser record carries, decided by the server.
 *
 * The browser controls its payload, so the resource it sent — including
 * `service.name` — is discarded. Without this, an anonymous caller could post
 * spans or logs claiming to be `feeblo-server` and mislead backend alerts.
 * Fabricated records under the browser's own identity remain possible; this
 * boundary only guarantees which service they can claim to be.
 */
export interface BrowserTelemetryIdentity {
  readonly service: string;
  readonly version: string;
  readonly environment: string;
}

const SpanRecord = Schema.Record(Schema.String, Schema.Json);
const LogRecord = Schema.Record(Schema.String, Schema.Json);
const TracePayload = Schema.fromJsonString(
  Schema.Struct({
    resourceSpans: Schema.Array(
      Schema.Struct({
        scopeSpans: Schema.Array(
          Schema.Struct({
            spans: Schema.Array(SpanRecord).check(
              Schema.isMaxLength(maxRecords)
            ),
          })
        ),
      })
    ),
  })
);
const LogPayload = Schema.fromJsonString(
  Schema.Struct({
    resourceLogs: Schema.Array(
      Schema.Struct({
        scopeLogs: Schema.Array(
          Schema.Struct({
            logRecords: Schema.Array(LogRecord).check(
              Schema.isMaxLength(maxRecords)
            ),
          })
        ),
      })
    ),
  })
);

const resource = (identity: BrowserTelemetryIdentity) => ({
  attributes: [
    { key: "service.name", value: { stringValue: identity.service } },
    { key: "service.version", value: { stringValue: identity.version } },
    {
      key: "deployment.environment.name",
      value: { stringValue: identity.environment },
    },
  ],
});

/**
 * Decode a browser batch and rebuild it under the server's identity.
 *
 * Only the records survive; the caller's resource, scope names and any extra
 * top-level fields are dropped. `undefined` means the body was not a valid
 * OTLP batch for this signal.
 */
export const browserBatch = (
  signal: "traces" | "logs",
  body: string,
  identity: BrowserTelemetryIdentity
): string | undefined => {
  if (signal === "traces") {
    const payload = Schema.decodeOption(TracePayload)(body);
    if (Option.isNone(payload)) return undefined;
    const spans = payload.value.resourceSpans.flatMap((entry) =>
      entry.scopeSpans.flatMap((scope) => scope.spans)
    );
    return JSON.stringify({
      resourceSpans: [
        {
          resource: resource(identity),
          scopeSpans: [{ scope: { name: identity.service }, spans }],
        },
      ],
    });
  }
  const payload = Schema.decodeOption(LogPayload)(body);
  if (Option.isNone(payload)) return undefined;
  const logRecords = payload.value.resourceLogs.flatMap((entry) =>
    entry.scopeLogs.flatMap((scope) => scope.logRecords)
  );
  return JSON.stringify({
    resourceLogs: [
      {
        resource: resource(identity),
        scopeLogs: [{ scope: { name: identity.service }, logRecords }],
      },
    ],
  });
};

const forward = (
  client: HttpClient.HttpClient,
  target: TelemetryTarget | undefined,
  body: string
) =>
  target === undefined
    ? // Telemetry is disabled on this deployment. Accept and discard: the
      // browser is not an operator, and a 4xx here becomes a console error on
      // every page without telling anyone why.
      Effect.succeed(empty(202))
    : Effect.gen(function* () {
        const request = HttpClientRequest.post(target.url, {
          body: HttpBody.text(body, "application/json"),
        });
        const withHeaders =
          target.headers === undefined
            ? request
            : HttpClientRequest.setHeaders(
                request,
                Redacted.value(target.headers)
              );
        const response = yield* client.execute(withHeaders);
        // The caller is an exporter that retries on failure; it must not be
        // told a dropped batch was accepted.
        if (response.status >= 300 && response.status < 400) return empty(502);
        // Release the socket without copying a collector response body into
        // the browser-facing response.
        yield* response.arrayBuffer;
        return empty(response.status >= 400 ? 502 : 202);
      }).pipe(
        Effect.timeoutOrElse({
          duration: telemetryRequestTimeout,
          orElse: () => Effect.succeed(empty(504)),
        }),
        Effect.catchTags({
          HttpClientError: () => Effect.succeed(empty(502)),
        })
      );

const relay =
  (
    client: HttpClient.HttpClient,
    signal: "traces" | "logs",
    target: TelemetryTarget | undefined,
    identity: BrowserTelemetryIdentity
  ) =>
  (
    request: HttpServerRequest.HttpServerRequest
  ): Effect.Effect<HttpServerResponse.HttpServerResponse> => {
    // Telemetry is off for this deployment. Discard quietly: a 4xx here only
    // becomes a console error on every page load.
    if (target === undefined) return Effect.succeed(empty(202));
    const contentType = request.headers["content-type"];
    if (
      contentType === undefined ||
      !contentType.startsWith("application/json")
    )
      return Effect.succeed(empty(415));
    return Effect.gen(function* () {
      const body = yield* request.text.pipe(
        Effect.provideService(HttpIncomingMessage.MaxBodySize, maxBodySize)
      );
      // `MaxBodySize` bounds decompression, not a plain text read, so the
      // relay enforces its own cap after buffering. The global body-limit
      // middleware already caps the request at 1 MB.
      if (new TextEncoder().encode(body).byteLength > maxBodyBytes)
        return empty(413);
      // The caller controls every field it sent. Rebuild the batch under the
      // server's identity before it reaches the collector with the server's
      // credentials; a malformed or mismatched batch is a client error.
      const batch = browserBatch(signal, body, identity);
      if (batch === undefined) return empty(400);
      return yield* forward(client, target, batch);
    }).pipe(
      // `MaxBodySize` fails the read with a `Cause`-wide error; the only
      // caller-visible distinction is "did the body fit".
      Effect.catchCause(() => Effect.succeed(empty(413)))
    );
  };

/**
 * Mount the browser relay.
 *
 * A deployment without OTLP configured accepts and discards a batch with 202.
 * The browser is not an operator: failing the request only adds a console
 * error to every page load, and the server has already said in its startup
 * configuration that no exporter is configured.
 */
export const makeBrowserTelemetryRouter = (
  options: {
    readonly service: string;
    readonly environment: string;
  },
  /**
   * The transport that reaches the collector. Production uses `fetch`; a test
   * supplies a recording client so the mount and validation rules are
   * exercised without a network.
   */
  clientLayer: Layer.Layer<HttpClient.HttpClient> = FetchHttpClient.layer
) =>
  HttpRouter.use((router) =>
    Effect.gen(function* () {
      const client = yield* HttpClient.HttpClient;
      const config = yield* telemetryConfig({
        // The browser speaks as its own service; joining it to the server's
        // service name would erase which half of the trace it is.
        service: `${options.service}-web`,
        environment: options.environment,
      }).pipe(Effect.option);
      // The service name is fixed here rather than read from `config`: an
      // operator-set `OTEL_SERVICE_NAME` must not let browser records claim
      // the server's identity.
      const identity: BrowserTelemetryIdentity = {
        service: `${options.service}-web`,
        version: Option.isNone(config) ? "dev" : config.value.version,
        environment: Option.isNone(config)
          ? options.environment
          : config.value.environment,
      };
      const traces = relay(
        client,
        "traces",
        Option.isNone(config) ? undefined : config.value.traces,
        identity
      );
      const logs = relay(
        client,
        "logs",
        Option.isNone(config) ? undefined : config.value.logs,
        identity
      );
      const unknown = () => Effect.succeed(empty(404));
      return yield* router
        .add("POST", "/api/telemetry/traces", traces)
        .pipe(
          Effect.andThen(router.add("POST", "/api/telemetry/logs", logs)),
          Effect.andThen(router.add("POST", "/api/telemetry/*", unknown))
        );
    })
  ).pipe(Layer.provide(clientLayer));

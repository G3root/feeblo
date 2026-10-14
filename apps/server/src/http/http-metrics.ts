import { Clock } from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as Metric from "effect/Metric";

import { redactedRequestPath } from "./request-label";

/** Requests served, by method, redacted path, and response status. */
export const httpServerRequests = Metric.counter(
  "feeblo_http_server_requests_total",
  {
    description: "HTTP requests served, by method, route, and response status",
  }
);

/**
 * Server-side request duration. Explicit bucket boundaries keep the series a
 * classic Prometheus histogram (`_bucket`), which every query tool understands.
 */
export const httpServerRequestDuration = Metric.histogram(
  "feeblo_http_server_request_duration_milliseconds",
  {
    boundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
    description: "Server-side request duration in milliseconds",
  }
);

/**
 * Exact request rate and latency, independent of trace sampling.
 *
 * The pre-response handler runs for every response the server finally sends,
 * including errors and unmatched routes, so the status code recorded here is
 * the one the client saw. Unmatched routes collapse to one `unmatched` label:
 * scanner traffic must not mint a route label per path. Trace-based APM in
 * Application Observability remains the place to see RPC methods, since every
 * call shares `POST /rpc`.
 */
export const httpMetricsMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.withFiber((fiber) => {
    const startedAt = fiber.getRef(Clock).monotonicTimeNanosUnsafe();
    return HttpEffect.withPreResponseHandler(httpApp, (request, response) => {
      const durationMs =
        Number(fiber.getRef(Clock).monotonicTimeNanosUnsafe() - startedAt) /
        1_000_000;
      const route =
        response.status === 404 ? "unmatched" : redactedRequestPath(request);
      return Effect.andThen(
        Metric.update(
          Metric.withAttributes(httpServerRequests, {
            method: request.method,
            route,
            status: String(response.status),
          }),
          1
        ),
        Metric.update(
          Metric.withAttributes(httpServerRequestDuration, {
            method: request.method,
            route,
          }),
          durationMs
        )
      ).pipe(Effect.as(response));
    });
  })
);

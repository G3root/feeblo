import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Metric from "effect/Metric";
import * as Option from "effect/Option";

/** Requests served, by method, matched route, and response status. */
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
 * the one the client saw. Matched requests are labeled with the router's route
 * template — a matched handler returning 404 keeps its template — and only
 * genuinely unmatched paths collapse to `unmatched`, so scanner traffic cannot
 * mint a route label per path. Trace-based APM in Application Observability
 * remains the place to see RPC methods, since every call shares `POST /rpc`.
 */
export const httpMetricsMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.gen(function* () {
    const startedAt = yield* Clock.monotonicTimeNanos;
    return yield* HttpEffect.withPreResponseHandler(
      httpApp,
      // The router sets `RouteContext` on the request fiber before invoking the
      // matched handler, and the pre-response handler runs before that fiber
      // ends, so a matched handler that answers 404 still reads its template.
      Effect.fnUntraced(function* (request, response) {
        const finishedAt = yield* Clock.monotonicTimeNanos;
        const durationMs = Number(finishedAt - startedAt) / 1_000_000;
        const route = Option.match(
          yield* Effect.serviceOption(HttpRouter.RouteContext),
          { onNone: () => "unmatched", onSome: (matched) => matched.route.path }
        );
        yield* Metric.update(
          Metric.withAttributes(httpServerRequests, {
            method: request.method,
            route,
            status: String(response.status),
          }),
          1
        );
        yield* Metric.update(
          Metric.withAttributes(httpServerRequestDuration, {
            method: request.method,
            route,
          }),
          durationMs
        );
        return response;
      })
    );
  })
);

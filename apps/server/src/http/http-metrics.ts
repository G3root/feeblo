import { Clock } from "effect/Clock";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpRouter from "effect/http/HttpRouter";
import * as Metric from "effect/Metric";

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
  Effect.withFiber((fiber) => {
    const startedAt = fiber.getRef(Clock).monotonicTimeNanosUnsafe();
    return HttpEffect.withPreResponseHandler(httpApp, (request, response) => {
      const durationMs =
        Number(fiber.getRef(Clock).monotonicTimeNanosUnsafe() - startedAt) /
        1_000_000;
      // The router sets `RouteContext` on the request fiber before invoking
      // the matched handler, so it is still visible when the response is sent.
      const matched = Context.getOption(fiber.context, HttpRouter.RouteContext);
      const route =
        matched._tag === "Some" ? matched.value.route.path : "unmatched";
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

import { Clock } from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/http/HttpEffect";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as Option from "effect/Option";

import { requestLabel } from "./request-label";

/**
 * Adds timing headers to every response:
 *
 * - `Server-Timing: total;dur=<ms>;desc="GET /health"` — the W3C-standard,
 *   structured form. When a request span exists, its trace, span, and
 *   sampling decision follow as `feeblo-trace`, `feeblo-span`, and
 *   `feeblo-sampled`, so a client can quote the trace in a support report.
 * - `X-Response-Time: <ms>ms` — the widely tooled (e.g., Express-style)
 *   convenience form.
 *
 * Both carry the total server-side request duration in milliseconds, measured
 * with the monotonic clock so wall-clock adjustments cannot skew the value.
 * It is registered as a pre-response handler so the headers are present on
 * error responses (404, 5xx) as well as successful ones.
 */
export const serverTimingMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.withFiber((fiber) => {
    const startedAt = fiber.getRef(Clock).monotonicTimeNanosUnsafe();
    return Effect.gen(function* () {
      const span = yield* Effect.currentSpan.pipe(Effect.option);
      return yield* HttpEffect.withPreResponseHandler(
        httpApp,
        (request, response) => {
          const duration =
            Number(fiber.getRef(Clock).monotonicTimeNanosUnsafe() - startedAt) /
            1_000_000;
          const durationMs = duration.toFixed(2);
          const timings = [
            `total;dur=${durationMs};desc="${requestLabel(request)}"`,
          ];
          if (Option.isSome(span)) {
            timings.push(`feeblo-trace;desc="${span.value.traceId}"`);
            timings.push(`feeblo-span;desc="${span.value.spanId}"`);
            timings.push(
              `feeblo-sampled;desc="${span.value.sampled ? "1" : "0"}"`
            );
          }
          return Effect.succeed(
            HttpServerResponse.setHeaders(response, {
              "server-timing": timings.join(", "),
              "x-response-time": `${durationMs}ms`,
            })
          );
        }
      );
    });
  })
);

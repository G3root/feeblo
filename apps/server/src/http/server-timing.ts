import { Clock } from "effect/Clock";
import * as Effect from "effect/Effect";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpMiddleware from "effect/unstable/http/HttpMiddleware";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

/**
 * Human-readable request label used to identify each timing entry. The SES
 * feedback webhook embeds its signing token in the URL path, so that segment
 * is redacted to the route pattern before the label is emitted.
 */
const requestLabel = (request: HttpServerRequest.HttpServerRequest): string => {
  const path = request.url.split("?")[0] ?? "";
  const redacted = path.replace(/^(\/email-provider\/ses\/).+$/, "$1:token");
  return `${request.method} ${redacted}`;
};

/**
 * Adds timing headers to every response:
 *
 * - `Server-Timing: total;dur=<ms>;desc="GET /health"` — the W3C-standard,
 *   structured form.
 * - `X-Response-Time: <ms>ms` — the widely tooled (e.g. Express-style)
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
    return HttpEffect.withPreResponseHandler(httpApp, (request, response) => {
      const duration =
        Number(fiber.getRef(Clock).monotonicTimeNanosUnsafe() - startedAt) /
        1_000_000;
      const durationMs = duration.toFixed(2);
      return Effect.succeed(
        HttpServerResponse.setHeaders(response, {
          "server-timing": `total;dur=${durationMs};desc="${requestLabel(request)}"`,
          "x-response-time": `${durationMs}ms`,
        })
      );
    });
  })
);

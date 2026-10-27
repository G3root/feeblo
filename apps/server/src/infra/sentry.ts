/**
 * Server error reporting.
 *
 * Sentry is the error tracker only. Tracing, logs, and metrics belong to the
 * Effect OTLP exporters in `infra/telemetry`, so `tracesSampleRate` stays `0`
 * and no Sentry performance instrumentation is installed. This mirrors
 * `UsefulSoftwareCo/executor`'s split and the browser half in
 * `packages/web-shared/src/observability`.
 *
 * Two failures are not incidents and never leave the process as Sentry events:
 *
 * - client rejections (`HttpApiSchemaError` on request parts, and tagged
 *   errors declaring a 4xx `httpApiStatus`), which are recorded on the request
 *   span instead;
 * - interruptions, which are cancellation, not failure.
 *
 * Everything else — including defects — is captured with the fiber's context:
 * the signed-in user and organization, and the parent span's trace and span
 * ids.
 */
import { CurrentSession } from "@feeblo/domain/session-middleware";
import { isNumber } from "@feeblo/utils/runtime-kind";
import * as Sentry from "@sentry/node";
import * as Cause from "effect/Cause";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as ErrorReporter from "effect/ErrorReporter";
import * as HttpMiddleware from "effect/http/HttpMiddleware";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as Tracer from "effect/Tracer";

import { isRequestRejection } from "../http/request-rejection";

/** How long a shutdown may spend delivering the last captured events. */
const flushTimeoutMillis = 2_000;

/**
 * Declared client errors. The status lives on the error's schema annotations,
 * which is how the HTTP API decides the response code, so filtering here can
 * never disagree with the status the caller saw.
 */
const isClientStatusError = (error: Error): boolean => {
  // SAFETY: `Schema.TaggedError` stores its options — including
  // `httpApiStatus` — on the constructor's schema AST. A non-schema
  // constructor has no AST, which `isSchema` rules out.
  if (!Schema.isSchema(error.constructor)) return false;
  const status = SchemaAST.resolveAt<unknown>("httpApiStatus")(
    // SAFETY: the guard above proves this is a schema; its `ast` is an AST.
    error.constructor.ast
  );
  return isNumber(status) && status >= 400 && status < 500;
};

const isClientRejection = (error: Error): boolean =>
  isRequestRejection(error) || isClientStatusError(error);

/** Reasons worth reporting, after client rejections and interruptions are removed. */
const reportableReasons = (cause: Cause.Cause<unknown>) =>
  cause.reasons.filter((reason) => {
    if (reason._tag === "Interrupt") return false;
    const error = reason._tag === "Fail" ? reason.error : reason.defect;
    return !(error instanceof Error) || !isClientRejection(error);
  });

/** Only the opaque user id is read; the session shape is owned elsewhere. */
const sessionUserId = (context: Context.Context<never>): string | undefined =>
  Option.map(
    Context.getOption(context, CurrentSession),
    (session) => session.user.id
  ).pipe(Option.getOrUndefined);

const captureCause = (
  cause: Cause.Cause<unknown>,
  context: Context.Context<never>
) => {
  const reasons = reportableReasons(cause);
  if (reasons.length === 0) return;
  const exception = Cause.squash(Cause.fromReasons(reasons));
  Sentry.withScope((scope) => {
    scope.setTag("product_version", "1");
    const userId = sessionUserId(context);
    if (userId !== undefined) scope.setUser({ id: userId });
    const span = Context.getOption(context, Tracer.ParentSpan);
    if (Option.isSome(span))
      scope.setContext("trace", {
        trace_id: span.value.traceId,
        span_id: span.value.spanId,
      });
    Sentry.captureException(exception);
  });
};

/**
 * Report every failure a request produces, whether or not a handler later
 * turns it into a response. Without this boundary only failures that escape
 * the server would be reported, and a 500 the server catches and renders would
 * look like a success.
 */
export const errorReportingMiddleware = HttpMiddleware.make((httpApp) =>
  Effect.withErrorReporting(httpApp)
);

/**
 * Build the reporter and initialize the SDK. A deployment without
 * `SENTRY_DSN` gets an empty layer: the middleware and the reporter calls
 * still compose, but no event leaves the process.
 */
export const makeSentryObservability = (options: {
  readonly environment: string;
}) =>
  Layer.unwrap(
    Effect.gen(function* () {
      const dsn = yield* Config.String("SENTRY_DSN").pipe(Config.option);
      if (Option.isNone(dsn) || dsn.value.trim().length === 0)
        return Layer.empty;
      const environment = yield* Config.String("SENTRY_ENVIRONMENT").pipe(
        Config.withDefault(options.environment)
      );
      const release = yield* Config.String("APP_RELEASE").pipe(
        Config.withDefault("dev")
      );
      yield* Effect.sync(() =>
        Sentry.init({
          dsn: dsn.value,
          environment,
          release,
          // Trace data is OTLP's job; Sentry is error reporting only.
          tracesSampleRate: 0,
          sendDefaultPii: false,
          enableLogs: false,
        })
      );
      const reporter = ErrorReporter.make(({ cause, fiber }) =>
        captureCause(cause, fiber.context)
      );
      return Layer.merge(
        ErrorReporter.layer([reporter], { mergeWithExisting: true }),
        Layer.effectDiscard(
          Effect.acquireRelease(Effect.void, () =>
            Effect.promise(async () => {
              await Sentry.flush(flushTimeoutMillis);
            }).pipe(Effect.ignore)
          )
        )
      );
    })
  );

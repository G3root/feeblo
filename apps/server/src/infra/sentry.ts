import * as Sentry from "@sentry/effect/server";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Tracer from "effect/Tracer";

import type { ServerConfigValue } from "../config";

export interface SentryLayerOptions {
  readonly logger?: boolean | undefined;
  readonly metrics?: boolean | undefined;
  readonly tracer?: boolean | undefined;
}

/**
 * Sentry is the error channel. Tracing, logging, and metrics can be disabled
 * piecemeal because `makeObservabilityLayer` hands tracing to the OTLP
 * exporters once an OTLP endpoint is configured (see `docs/telemetry.md`).
 */
export const makeSentryLayer = (
  config: ServerConfigValue,
  options?: SentryLayerOptions
): Layer.Layer<never> => {
  if (!config.sentryDsn) {
    return Layer.empty;
  }
  const { logger = true, metrics = true, tracer = true } = options ?? {};
  return Layer.mergeAll(
    Sentry.effectLayer({
      dsn: config.sentryDsn,
      enableLogs: true,
      environment: config.sentryEnvironment,
      tracesSampleRate: config.sentryTracesSampleRate,
    }),
    tracer
      ? Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer)
      : Layer.empty,
    logger
      ? Logger.layer([Sentry.SentryEffectLogger], { mergeWithExisting: true })
      : Layer.empty,
    metrics ? Sentry.SentryEffectMetricsLayer : Layer.empty
  );
};

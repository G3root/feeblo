import * as Sentry from "@sentry/effect/server";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Tracer from "effect/Tracer";

import type { ServerConfigValue } from "../config";

export const makeSentryLayer = (
  config: ServerConfigValue
): Layer.Layer<never> =>
  config.sentryDsn
    ? Layer.mergeAll(
        Sentry.effectLayer({
          dsn: config.sentryDsn,
          enableLogs: true,
          environment: config.sentryEnvironment,
          tracesSampleRate: config.sentryTracesSampleRate,
        }),
        Layer.succeed(Tracer.Tracer, Sentry.SentryEffectTracer),
        Logger.layer([Sentry.SentryEffectLogger]),
        Sentry.SentryEffectMetricsLayer
      )
    : Layer.empty;

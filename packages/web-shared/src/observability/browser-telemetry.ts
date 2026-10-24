/**
 * Browser-owned Effect telemetry.
 *
 * Traces and logs are Effect's native OTLP exporters (`effect/observability`),
 * posted as OTLP/JSON to same-origin host relays. The browser never holds a
 * collector credential: the host owns the destination and forwards the batch
 * (`apps/server/src/http/browser-telemetry.ts`).
 *
 * This is the browser half of the same split the server uses in
 * `apps/server/src/infra/telemetry`: Sentry reports errors, OTLP reports
 * traces. Ported from `UsefulSoftwareCo/executor`'s
 * `packages/telemetry/src/browser.ts`.
 */
import { hasWindow } from "@feeblo/utils/runtime-kind";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  FiberSet,
  Layer,
  Logger,
  ManagedRuntime,
} from "effect";
import { FetchHttpClient } from "effect/http";
import {
  OtlpExporter,
  OtlpLogger,
  OtlpSerialization,
  OtlpTracer,
} from "effect/observability";

import { firstPartyFailure } from "./browser-errors";

/** Public, browser-safe telemetry identity and same-origin relay URLs. */
export interface BrowserTelemetrySettings {
  readonly service: string;
  readonly version: string;
  readonly environment: string;
  readonly tracesUrl: string;
  readonly logsUrl: string;
  /** Directory holding this surface's built chunks, from the app entry's `import.meta.url`. */
  readonly scripts: string;
}

/** Page events use the same tracer and export scope as browser API operations. */
export class BrowserTelemetry extends Context.Service<
  BrowserTelemetry,
  {
    /**
     * `load` names the document's initial route without a span: hydration
     * resolves no route change, and first load is measured by the error and
     * navigation listeners. `start` opens a `ui.navigation` span that the
     * router's next `end` closes or the next `start` interrupts.
     */
    readonly navigation: (
      event:
        | { readonly type: "load" | "start"; readonly path: string }
        | { readonly type: "end" }
    ) => Effect.Effect<void>;
    readonly flush: Effect.Effect<void>;
  }
>()("feeblo/BrowserTelemetry") {}

/** How long the page may wait for its final batch while it unloads. */
const flushTimeout = "2 seconds" as const;

/**
 * Build the browser's exporters. `credentials: "same-origin"` never sends the
 * session cookie to a different API origin, and `keepalive` lets the final
 * batch leave after `pagehide`.
 */
const browserTelemetryLayer = (settings: BrowserTelemetrySettings) => {
  const resource = {
    serviceName: settings.service,
    serviceVersion: settings.version,
    attributes: { "deployment.environment.name": settings.environment },
  };
  const console = Logger.layer([Logger.withConsoleError(Logger.formatJson)]);
  const exporter = (url: string) => ({
    url,
    resource,
    // A page lives for seconds to minutes; a one-second batch keeps a trace
    // queryable before the visitor closes the tab.
    exportInterval: "1 second" as const,
    shutdownTimeout: flushTimeout,
  });
  return Layer.effect(
    BrowserTelemetry,
    Effect.gen(function* () {
      const flusher = yield* OtlpExporter.Flusher;
      const run = yield* FiberSet.makeRuntime();
      // `hidden` records whether the page was hidden at any point before the route resolved.
      let navigation:
        | { readonly done: Deferred.Deferred<void>; hidden: boolean }
        | undefined;
      const flush = flusher.flush.pipe(
        Effect.timeoutOption(flushTimeout),
        Effect.asVoid
      );
      const error = (name: string, value: Error) =>
        run(
          Effect.logError(Cause.die(value)).pipe(
            Effect.andThen(Effect.fail(value)),
            Effect.withSpan(name),
            Effect.ignore
          )
        );
      // A page-level handler also sees extension and injected-script failures.
      // The same first-party filter Sentry uses decides what belongs to the
      // app, so both reporting paths agree.
      const onError = (event: ErrorEvent) => {
        if (
          event.error instanceof Error &&
          firstPartyFailure(event.error, settings.scripts)
        )
          error("ui.error", event.error);
      };
      const onRejection = (event: PromiseRejectionEvent) => {
        if (
          event.reason instanceof Error &&
          firstPartyFailure(event.reason, settings.scripts)
        )
          error("ui.unhandled-rejection", event.reason);
      };
      const onHidden = () => {
        if (navigation !== undefined && document.visibilityState === "hidden")
          navigation.hidden = true;
        if (document.visibilityState === "hidden") run(flush);
      };
      const onPageHide = () => run(flush);
      window.addEventListener("error", onError);
      window.addEventListener("unhandledrejection", onRejection);
      window.addEventListener("pagehide", onPageHide);
      document.addEventListener("visibilitychange", onHidden);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          window.removeEventListener("error", onError);
          window.removeEventListener("unhandledrejection", onRejection);
          window.removeEventListener("pagehide", onPageHide);
          document.removeEventListener("visibilitychange", onHidden);
        })
      );
      return {
        flush,
        navigation: (
          event:
            | { readonly type: "load" | "start"; readonly path: string }
            | { readonly type: "end" }
        ) =>
          Effect.sync(() => {
            if (event.type === "load") return;
            if (event.type === "end") {
              if (navigation !== undefined)
                Deferred.doneUnsafe(navigation.done, Effect.void);
              navigation = undefined;
              return;
            }
            if (navigation !== undefined)
              Deferred.doneUnsafe(navigation.done, Effect.interrupt);
            const current = {
              done: Deferred.makeUnsafe<void>(),
              hidden: document.visibilityState === "hidden",
            };
            navigation = current;
            run(
              Deferred.await(current.done).pipe(
                // Record visibility however the navigation ends, including when a later one interrupts it.
                Effect.ensuring(
                  Effect.suspend(() =>
                    Effect.annotateCurrentSpan(
                      "feeblo.navigation.hidden",
                      current.hidden
                    )
                  )
                ),
                Effect.withSpan("ui.navigation", {
                  root: true,
                  attributes: { "url.path": event.path },
                }),
                Effect.ignore
              )
            );
          }),
      };
    })
  ).pipe(
    // The page builds one layer for its whole lifetime, so the process
    // lifetime is right: batches export every second and on finalization.
    Layer.provideMerge(
      Layer.mergeAll(
        OtlpTracer.layer(exporter(settings.tracesUrl)).pipe(
          Layer.provide(OtlpSerialization.layerJson)
        ),
        OtlpLogger.layer({
          ...exporter(settings.logsUrl),
          mergeWithExisting: true,
        }).pipe(
          Layer.provide(OtlpSerialization.layerJson),
          Layer.provideMerge(console)
        )
      )
    ),
    Layer.provide(
      FetchHttpClient.layer.pipe(
        Layer.provide(
          Layer.succeed(FetchHttpClient.RequestInit, {
            keepalive: true,
            credentials: "same-origin",
          })
        )
      )
    ),
    Layer.provide(console)
  );
};

interface BrowserTelemetryHandle {
  readonly runtime: ManagedRuntime.ManagedRuntime<BrowserTelemetry, never>;
  readonly flush: Effect.Effect<void, never, BrowserTelemetry>;
  readonly navigation: (
    event:
      | { readonly type: "load" | "start"; readonly path: string }
      | { readonly type: "end" }
  ) => Effect.Effect<void, never, BrowserTelemetry>;
}

let handle: BrowserTelemetryHandle | undefined;

/**
 * Install the page's telemetry once. A build without relay URLs (local,
 * self-host without a collector, tests) stays a no-op.
 */
export const startBrowserTelemetry = (
  settings: BrowserTelemetrySettings
): void => {
  if (handle !== undefined || !hasWindow()) return;
  const runtime = ManagedRuntime.make(browserTelemetryLayer(settings));
  handle = {
    runtime,
    flush: Effect.flatMap(BrowserTelemetry, (telemetry) => telemetry.flush),
    navigation: (event) =>
      Effect.flatMap(BrowserTelemetry, (telemetry) =>
        telemetry.navigation(event)
      ),
  };
};

/** Record a router navigation. Safe before start or without telemetry configured. */
export const recordBrowserNavigation = (
  event:
    | { readonly type: "load" | "start"; readonly path: string }
    | { readonly type: "end" }
): void => {
  if (handle !== undefined)
    void handle.runtime.runFork(handle.navigation(event));
};

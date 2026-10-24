import { hasWindow } from "@feeblo/utils/runtime-kind";
/**
 * The browser's observability composition root.
 *
 * Everything here starts before hydration, so a failure in the first render or
 * a module chunk is captured and the first route change is traced. It is
 * installed by `router.tsx`, which both the dashboard and the public board
 * load, so the two surfaces report the same way.
 *
 * Sentry reports errors only (`tracesSampleRate: 0`). Traces and logs are
 * Effect's OTLP exporters, posted same-origin to `/telemetry/{traces,logs}` and
 * relayed by the web server to the API, which owns the collector credential.
 * That keeps delivery working on customer custom domains, where a cross-origin
 * post to the API origin would fail the origin check.
 */
// oxlint-disable typescript/no-unnecessary-type-parameters -- A captured failure is any value a browser handler can throw. A generic parameter accepts it without naming `unknown` (banned by anti-slop), and the SDK accepts the value unchanged.
import {
  recordBrowserNavigation,
  startBrowserTelemetry,
} from "@feeblo/web-shared/browser-telemetry";
import {
  captureBrowserError,
  scriptDirectory,
  startErrorReporting,
} from "@feeblo/web-shared/error-reporting";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import type { AnyRouter } from "@tanstack/react-router";

const environment = (): string => {
  const env = getRuntimePublicEnv();
  return (
    env.sentryEnvironment ??
    (import.meta.env.DEV ? "development" : "production")
  );
};

/** Same-origin on every host, including a customer's custom board domain. */
const telemetryUrl = (signal: "traces" | "logs"): string =>
  new URL(`/telemetry/${signal}`, window.location.origin).href;

let telemetryStarted = false;

/**
 * Start the Effect OTLP exporters once per document. The public board is a
 * first-class surface: its page loads and navigation spans are traced too.
 */
export const startWebTelemetry = (): void => {
  if (telemetryStarted || !hasWindow()) return;
  telemetryStarted = true;
  const env = getRuntimePublicEnv();
  startBrowserTelemetry({
    service: "feeblo-web",
    version: env.appRelease ?? "dev",
    environment: environment(),
    tracesUrl: telemetryUrl("traces"),
    logsUrl: telemetryUrl("logs"),
  });
  recordBrowserNavigation({ type: "load", path: window.location.pathname });
};

/** Without an operator-configured DSN the SDK stays off; local builds report nothing. */
export const startWebErrorReporting = (): void => {
  if (!hasWindow()) return;
  const env = getRuntimePublicEnv();
  if (env.sentryDsn === undefined || env.sentryDsn.length === 0) return;
  startErrorReporting({
    dsn: env.sentryDsn,
    environment: environment(),
    release: env.appRelease ?? "dev",
    tunnel: "/sentry-tunnel",
    // The dashboard and the public board share this bundle graph and the
    // board's visitor URL does not reveal which one it is (the router rewrites
    // it internally). Product analytics tags the dashboard `dashboard`; this
    // tag stays at the app level.
    surface: "web",
    scripts: scriptDirectory(import.meta.url),
  });
};

/** A failure caught by the router's error boundary (`defaultOnCatch`). */
export const reportRouteError = <T>(error: T): void => {
  captureBrowserError(error, { boundary: "route" });
};

/**
 * Open a `ui.navigation` span for each client-side route change and close it
 * when the route resolves, so a slow loader is visible as navigation time
 * rather than a gap before the next request. Returns the unsubscribe pair.
 */
export const startNavigationTelemetry = (router: AnyRouter): (() => void) => {
  if (!hasWindow()) return () => {};
  const start = router.subscribe("onBeforeNavigate", (event) => {
    recordBrowserNavigation({
      type: "start",
      path: event.toLocation.pathname,
    });
  });
  const end = router.subscribe("onResolved", () => {
    recordBrowserNavigation({ type: "end" });
  });
  return () => {
    start();
    end();
  };
};

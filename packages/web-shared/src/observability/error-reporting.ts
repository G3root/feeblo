/**
 * Browser error reporting.
 *
 * Sentry is the error tracker only: `tracesSampleRate` is `0` because traces
 * travel through the Effect OTLP exporters (`browser-telemetry.ts`). This
 * mirrors `UsefulSoftwareCo/executor`'s split between the two systems.
 *
 * Two rules shape the init below:
 *
 * - Credential-bearing URLs never reach Sentry. OAuth codes, MCP authorization
 *   parameters and invitation tokens travel in the query string or fragment of
 *   a first-visit link, so every request URL and navigation breadcrumb is
 *   stripped before an event leaves the page.
 * - A page-level handler sees failures from extensions and injected scripts.
 *   An automatically captured event is kept only when the throwing frame is
 *   inside one of this surface's own chunks (`firstPartyFailure`).
 */

// oxlint-disable typescript/no-unnecessary-type-parameters -- A captured failure is any value a browser handler can throw. A generic parameter accepts it without naming `unknown` (banned by anti-slop), and the SDK accepts the value unchanged.
import { isPlainObject, isString } from "@feeblo/utils/runtime-kind";
import * as Sentry from "@sentry/react";

import {
  automaticBrowserCapture,
  firstPartyFailure,
  scriptDirectory,
} from "./browser-errors";
import { browserPageId } from "./page-id";

/** Identity attached to every captured event. Only the opaque user id is sent. */
export interface ErrorReportingUser {
  readonly id: string;
}

export interface BrowserErrorReportingSettings {
  readonly dsn: string;
  readonly environment: string;
  readonly release: string;
  /**
   * Same-origin path that forwards the Sentry envelope. `undefined` sends
   * directly to Sentry, which some ad blockers and privacy extensions drop.
   */
  readonly tunnel?: string | undefined;
  /** Which Feeblo surface this bundle is: `dashboard`, `board`, `widget`. */
  readonly surface: string;
  /** Directory holding this surface's built chunks, from the app entry's `import.meta.url`. */
  readonly scripts: string;
}

const operationFailedEvent = "feeblo:operation-failed";

/** Tie every event in this document to the same page load when one exists. */
const pageTag = (): { page_id?: string } => {
  const id = browserPageId();
  return id === undefined ? {} : { page_id: id };
};

/**
 * OAuth codes, MCP authorization parameters and invitation tokens all travel in
 * the query string or fragment of a first-visit URL. Nothing carrying one may
 * reach Sentry, from a request URL or from a navigation, fetch or XHR
 * breadcrumb.
 */
export const strippedUrl = (value: string): string => {
  const url = URL.parse(value, "https://feeblo.invalid");
  if (url === null) return value;
  url.search = "";
  url.hash = "";
  return url.origin === "https://feeblo.invalid" ? url.pathname : url.href;
};

/** Breadcrumb URLs live in `data`; the SDK records them as relative paths with a query. */
export const strippedBreadcrumb = <
  A extends { data?: Record<string, string | undefined> | undefined },
>(
  crumb: A
): A => {
  const data = crumb.data;
  if (data === undefined) return crumb;
  for (const key of ["from", "to", "url"]) {
    const value = data[key];
    if (isString(value)) data[key] = strippedUrl(value);
  }
  return crumb;
};

let started = false;
let scripts = "";

/**
 * The error type recorded on an event and on the product-analytics event.
 *
 * Tagged Effect failures carry `_tag`; a decoded error is a plain object. The
 * value is bounded and restricted to a safe alphabet because it becomes a
 * Sentry fingerprint and a PostHog property.
 */
export const errorType = <T>(error: T): string => {
  const candidate =
    error instanceof Error
      ? error.name
      : isPlainObject(error) && "_tag" in error && isString(error._tag)
        ? error._tag
        : "UnknownError";
  return isString(candidate) && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(candidate)
    ? candidate
    : "UnknownError";
};

/**
 * Report a failure from a React render, router boundary, or client operation.
 *
 * The same call emits `feeblo:operation-failed`, which PostHog turns into a
 * `browser_operation_failed` product event; the two systems then describe the
 * same failure without either owning the other's transport.
 */
export const captureBrowserError = <T>(
  error: T,
  tags?: Record<string, string>
): void => {
  // Product analytics listens independently of Sentry: a deployment may
  // configure PostHog without an error tracker, and the event is still useful.
  if (started) {
    if (tags === undefined) Sentry.captureException(error);
    else Sentry.captureException(error, { tags });
  }
  const detail = { error_type: errorType(error) };
  const id = browserPageId();
  if (id !== undefined) Object.assign(detail, { page_id: id });
  if (tags !== undefined) Object.assign(detail, { tags });
  window.dispatchEvent(new CustomEvent(operationFailedEvent, { detail }));
};

/** Keep Sentry's user context aligned with confirmed sign-in and sign-out state. */
export const setErrorReportingUser = (
  user: ErrorReportingUser | null
): void => {
  if (!started) return;
  Sentry.setUser(user === null ? null : { id: user.id });
};

const reportReactError = <T>(
  error: T,
  info: { componentStack?: string | undefined }
): void => {
  Sentry.reactErrorHandler()(
    error,
    info.componentStack === undefined
      ? {}
      : { componentStack: info.componentStack }
  );
};

/** React 19 forwards caught and uncaught failures; normalize its optional stack at the SDK boundary. */
export const reactErrorHandlers = {
  onUncaughtError: reportReactError,
  onCaughtError: reportReactError,
  onRecoverableError: reportReactError,
};

/**
 * Initialize once at the browser composition root. A build without a DSN
 * reports nothing; local development therefore stays quiet.
 */
export const startErrorReporting = (
  settings: BrowserErrorReportingSettings
): void => {
  if (started || settings.dsn.length === 0) return;
  scripts = settings.scripts;
  const options: Parameters<typeof Sentry.init>[0] = {
    dsn: settings.dsn,
    environment: settings.environment,
    release: settings.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: {
      tags: {
        product_version: "1",
        surface: settings.surface,
        ...pageTag(),
      },
    },
    // Breadcrumbs are attached before this hook runs, so they are scrubbed here too.
    beforeBreadcrumb: (crumb) => strippedBreadcrumb(crumb),
    beforeSend: (event, hint) => {
      if (
        automaticBrowserCapture(event) &&
        !firstPartyFailure(hint.originalException, scripts)
      )
        return null;
      if (event.request) {
        delete event.request.cookies;
        delete event.request.headers;
        delete event.request.data;
        if (event.request.url)
          event.request.url = strippedUrl(event.request.url);
      }
      if (event.breadcrumbs)
        event.breadcrumbs = event.breadcrumbs.map(strippedBreadcrumb);
      return event;
    },
  };
  if (settings.tunnel !== undefined) options.tunnel = settings.tunnel;
  Sentry.init(options);
  started = true;
};

/** Boot failures are reported after early initialization, with no entry data attached. */
export const reportBootFailure = <T>(error: T): void => {
  if (started) Sentry.captureException(error);
};

export { scriptDirectory };

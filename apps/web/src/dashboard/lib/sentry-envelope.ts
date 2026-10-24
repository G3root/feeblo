/**
 * Sentry envelope validation for the same-origin tunnel.
 *
 * Ad blockers and privacy extensions drop requests to `*.ingest.sentry.io`,
 * so the browser posts its envelope to the web app and the server forwards
 * it. The DSN is public, so the only checks are that the envelope names the
 * project this deployment is configured for and that the body is bounded.
 *
 * Ported from `UsefulSoftwareCo/executor`'s
 * `apps/hosted/cloud/src/implementation/error-tunnel.ts`.
 */

import { isPlainObject, isString } from "@feeblo/utils/runtime-kind";

/** The largest envelope the tunnel will forward. */
export const maxEnvelopeBytes = 256 * 1024;

/**
 * The Sentry ingestion URL for an envelope, or `undefined` when the envelope
 * is malformed or addressed to a different project.
 *
 * The destination is derived from the configured DSN, never from the
 * envelope, so a caller cannot redirect the forward anywhere else.
 */
export const envelopeTarget = (
  body: string,
  expectedDsn: string
): string | undefined => {
  const newline = body.indexOf("\n");
  if (newline < 0 || newline > 8192) return undefined;
  // `JSON.parse` returns any value, including `null`, a string, or an array;
  // reading `.dsn` off a non-object would throw and turn a malformed envelope
  // into a 500. Parse at the boundary and narrow before the read.
  let header: unknown;
  try {
    header = JSON.parse(body.slice(0, newline));
  } catch {
    return undefined;
  }
  if (!isPlainObject(header) || !("dsn" in header)) return undefined;
  if (!isString(header.dsn) || header.dsn !== expectedDsn) return undefined;
  let dsn: URL;
  try {
    dsn = new URL(expectedDsn);
  } catch {
    return undefined;
  }
  if (dsn.protocol !== "https:" || !/^\/\d+$/.test(dsn.pathname))
    return undefined;
  return `${dsn.origin}/api${dsn.pathname}/envelope/?sentry_version=7&sentry_key=${encodeURIComponent(dsn.username)}`;
};

/**
 * Whether a request may carry a Sentry envelope.
 *
 * `application/x-sentry-envelope` is the documented type and `text/plain` is
 * what a browser envelope proxy may forward. The browser SDK's fetch
 * transport sets no `Content-Type` at all, so a missing header is also
 * accepted; the envelope's own DSN is the real check.
 */
export const isEnvelopeContentType = (value: string | null): boolean => {
  if (value === null) return true;
  const mediaType = value.split(";")[0]?.trim();
  return (
    mediaType === "application/x-sentry-envelope" || mediaType === "text/plain"
  );
};

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
  let header: { readonly dsn?: string };
  try {
    header = JSON.parse(body.slice(0, newline));
  } catch {
    return undefined;
  }
  if (header.dsn !== expectedDsn) return undefined;
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

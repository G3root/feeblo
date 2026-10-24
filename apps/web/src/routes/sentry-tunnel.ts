import { createFileRoute } from "@tanstack/react-router";

import { envelopeTarget, maxEnvelopeBytes } from "~/lib/sentry-envelope";
import { getPublicEnvServer } from "~/lib/server-runtime-public-env";

/**
 * Same-origin delivery for the browser's Sentry envelopes.
 *
 * Ad blockers and privacy extensions drop requests to `*.ingest.sentry.io`,
 * so the browser posts here and the server forwards the envelope. This is a
 * plain relay, not an authenticator: the DSN is public, so the only checks are
 * that the envelope names the project this deployment is configured for and
 * that the body is bounded. No credential ever reaches the page.
 */
const empty = (status: number, headers?: Record<string, string>): Response => {
  if (headers === undefined) return new Response(null, { status });
  return new Response(null, { status, headers });
};

const tunnel = async (request: Request): Promise<Response> => {
  const dsn = getPublicEnvServer().SENTRY_DSN;
  if (dsn === undefined || dsn.length === 0) return empty(404);
  if (
    !request.headers
      .get("content-type")
      ?.startsWith("application/x-sentry-envelope")
  )
    return empty(415);
  // Sentry always sends a Content-Length. Requiring it keeps a chunked
  // request from buffering an unbounded body before the size check runs.
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength > maxEnvelopeBytes)
    return empty(413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxEnvelopeBytes)
    return empty(413);
  const target = envelopeTarget(body, dsn);
  if (target === undefined) return empty(400);
  try {
    const upstream = await fetch(target, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-sentry-envelope" },
      redirect: "manual",
    });
    // Sentry's rate-limit answer belongs to the browser SDK, which honours
    // it; the body does not.
    await upstream.arrayBuffer();
    const headers: Record<string, string> = {};
    for (const name of ["x-sentry-rate-limits", "retry-after"]) {
      const value = upstream.headers.get(name);
      if (value !== null) headers[name] = value;
    }
    return empty(upstream.status, headers);
  } catch {
    return empty(502);
  }
};

export const Route = createFileRoute("/sentry-tunnel")({
  server: {
    handlers: { POST: ({ request }) => tunnel(request) },
  },
});

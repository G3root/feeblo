import { createFileRoute } from "@tanstack/react-router";

import { getPublicEnvServer } from "~/lib/server-runtime-public-env";

/**
 * Same-origin browser telemetry relay.
 *
 * The browser's OTLP exporters post here, on whatever host serves the page,
 * including a customer's custom board domain. Forwarding server-to-server to
 * the API keeps the browser out of the API's origin check and keeps the
 * collector URL and its credentials on the server.
 *
 * Ported from `UsefulSoftwareCo/executor`'s same-origin browser telemetry
 * relay; the API half is `apps/server/src/http/browser-telemetry.ts`.
 */
const maxBodyBytes = 256 * 1024;
const upstreamTimeoutMillis = 5_000;

const isSignal = (value: string): value is "traces" | "logs" =>
  value === "traces" || value === "logs";

const empty = (status: number): Response => new Response(null, { status });

const relay = async (signal: string, request: Request): Promise<Response> => {
  if (!isSignal(signal)) return empty(404);
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    return empty(415);
  const declaredLength = Number(request.headers.get("content-length"));
  if (!Number.isFinite(declaredLength) || declaredLength > maxBodyBytes)
    return empty(413);
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > maxBodyBytes)
    return empty(413);
  const apiUrl = getPublicEnvServer().API_URL.replace(/\/+$/, "");
  try {
    const upstream = await fetch(`${apiUrl}/api/telemetry/${signal}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      signal: AbortSignal.timeout(upstreamTimeoutMillis),
    });
    // Release the body without copying a collector response into the page.
    await upstream.arrayBuffer();
    return empty(
      upstream.status >= 400 && upstream.status < 500 ? 502 : upstream.status
    );
  } catch {
    return empty(502);
  }
};

export const Route = createFileRoute("/telemetry/$signal")({
  server: {
    handlers: { POST: ({ params, request }) => relay(params.signal, request) },
  },
});

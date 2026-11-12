import { isPlainObject } from "@feeblo/utils/runtime-kind";
import { createFileRoute } from "@tanstack/react-router";

import { readBoundedText } from "~/lib/bounded-body";
import { getPublicEnvServer } from "~/lib/server-runtime-public-env";

/**
 * Same-origin page-view relay.
 *
 * The board posts here on whatever host serves the page, including a customer's
 * custom domain, and this route forwards server-to-server to the API. That is
 * the same arrangement as the browser telemetry relay next door: it keeps the
 * browser out of the API's origin check, and it is what makes a custom-domain
 * board work without adding the customer's domain to the deployment's trusted
 * origins.
 *
 * The browser's user agent and the edge's country are added to the body rather
 * than forwarded as headers: a server runtime that overwrites the outbound
 * `User-Agent` (Cloudflare Workers does) would otherwise make every view look
 * like a bot. A failed forward is dropped — a page view is not worth a retry the
 * page cannot observe, and the API answers the same whether it stored the view
 * or discarded it.
 */
const maxBodyBytes = 2 * 1024;
const upstreamTimeoutMillis = 3_000;
const trailingSlashPattern = /\/+$/;

const empty = (status: number): Response => new Response(null, { status });

const relay = async (request: Request): Promise<Response> => {
  const raw = await readBoundedText(request, maxBodyBytes);
  if (raw === undefined) return empty(413);

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    return empty(204);
  }
  if (!isPlainObject(decoded)) return empty(204);

  const userAgent = request.headers.get("user-agent");
  const country = request.headers.get("cf-ipcountry");
  // `undefined` is dropped by `JSON.stringify`, so an absent header and an
  // absent property are the same request to the API.
  const payload = {
    ...decoded,
    country: country ?? undefined,
    userAgent: userAgent ?? undefined,
  };

  const apiUrl = getPublicEnvServer().API_URL.replace(trailingSlashPattern, "");

  try {
    const upstream = await fetch(`${apiUrl}/api/traffic/v1/views`, {
      body: JSON.stringify(payload),
      headers: { "content-type": "application/json" },
      method: "POST",
      signal: AbortSignal.timeout(upstreamTimeoutMillis),
    });
    // Release the body without copying the API's answer into the page.
    await upstream.arrayBuffer();
  } catch {
    // Best effort by design; the counter undercounts one view, not the page.
  }

  return empty(204);
};

export const Route = createFileRoute("/traffic/view")({
  server: {
    handlers: {
      POST: ({ request }) => relay(request),
    },
  },
});

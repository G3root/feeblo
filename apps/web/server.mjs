import { serve } from "srvx/node";
import { serveStatic } from "srvx/static";

import handler from "./dist/server/server.js";

/**
 * The Node/self-hosted entry for the built app.
 *
 * TanStack Start's Vite build emits `dist/client` (static assets) and
 * `dist/server/server.js` (a fetch handler). srvx bridges Node's HTTP server
 * to that handler and serves the client directory first, which is the same
 * split the Cloudflare assets binding performs in the managed deployment.
 *
 * Used by the Docker image and the e2e suite; the Cloudflare build runs
 * through `wrangler` instead and never imports this file.
 */

const clientDirectory = new URL("./dist/client", import.meta.url).pathname;

/**
 * Cache headers for the static assets.
 *
 * srvx's static middleware sets none, and without them the browser
 * re-downloads the whole client bundle on every navigation — the Astro Node
 * adapter this replaced served `_astro/*` as immutable. Vite fingerprints
 * everything under `assets/`, so those files can be cached forever. The
 * widget's filenames are fixed (`widget.js` / `widget.css` are rewritten each
 * deploy), so they only get a short TTL.
 */
const staticCacheControl = async (request, next) => {
  const response = await next();
  const { pathname } = new URL(request.url);

  const cacheControl = pathname.startsWith("/assets/")
    ? "public, max-age=31536000, immutable"
    : pathname.startsWith("/widget/")
      ? "public, max-age=300"
      : undefined;

  if (!cacheControl) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", cacheControl);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

serve({
  fetch: handler.fetch,
  middleware: [
    staticCacheControl,
    serveStatic({
      dir: clientDirectory,
    }),
  ],
  port: process.env.PORT,
  hostname: process.env.HOST,
});

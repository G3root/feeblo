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
serve({
  fetch: handler.fetch,
  middleware: [
    serveStatic({
      dir: new URL("./dist/client", import.meta.url).pathname,
    }),
  ],
  port: process.env.PORT,
  hostname: process.env.HOST,
});

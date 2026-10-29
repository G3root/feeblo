import handler from "@tanstack/react-start/server-entry";

import {
  DASHBOARD_DISCOVERY_LINK,
  dashboardMarkdown,
  isDashboardRequest,
} from "./lib/agent-discovery";
import {
  applyPageSecurityHeaders,
  deploymentServesHttps,
  parseImageOrigins,
} from "./lib/security-headers";
import { paraglideMiddleware } from "./paraglide/server.js";

/**
 * The deployment's fetch entry.
 *
 * Paraglide's middleware resolves the request's locale from the cookie and
 * runs the rest of the request inside its `AsyncLocalStorage`, which is what
 * makes `getLocale()` and the `m.*()` messages agree between the server render
 * and the client. The original `request` is handed to the Start handler — the
 * locale strategy has no URL component, so there is nothing to de-localize and
 * the router's own rewrite must see the real path.
 *
 * Subdomain routing is *not* handled here: it is a router `rewrite`
 * (`lib/public-board-rewrite`), so the server and the browser make the same
 * public-to-internal mapping and links keep the visitor's spelling.
 *
 * Response headers are attached after the handler resolves, so they land on
 * every document — SSR pages, route errors, redirects, and the widget shell.
 * The one place they cannot move is `apps/web/server.mjs`'s static middleware,
 * which answers `/assets/*` and `/widget/*` before this entry runs; those are
 * fingerprinted bundles and fonts, not documents, so the directives that
 * matter (framing, `img-src`, referrer) have nothing to act on there.
 * `nosniff` is the exception, and the asset response's own `Content-Type`
 * already comes from Vite/srvx.
 */
export default {
  async fetch(request: Request) {
    const url = new URL(request.url);
    const dashboard = isDashboardRequest(request);
    const securityOptions = {
      // `MEDIA_PUBLIC_BASE_URL` is where uploaded editor media and workspace
      // logos are served from; without it the `img-src` allow-list would blank
      // every uploaded image. `CONTENT_IMAGE_ORIGINS` is the operator's
      // extension for avatar hosts a workspace's own SSO returns.
      imageOrigins: parseImageOrigins([
        process.env.MEDIA_PUBLIC_BASE_URL,
        process.env.CONTENT_IMAGE_ORIGINS,
      ]),
      // Read from the deployment's own configuration, not the request URL: the
      // Node container answers plain HTTP behind the TLS-terminating proxy, and
      // the bundle inlines `NODE_ENV` to the build mode.
      includeHsts: deploymentServesHttps({
        appUrl: process.env.APP_URL,
      }),
      pathname: url.pathname,
    };

    // An agent asking for Markdown on the root is not going to drive a React
    // app. Answer before the document renderer, whose HTML-only guard would
    // otherwise refuse the request with a 406.
    if (
      dashboard &&
      request.method === "GET" &&
      url.pathname === "/" &&
      (request.headers.get("accept")?.includes("text/markdown") ?? false)
    ) {
      const body = dashboardMarkdown(url.origin);

      return applyPageSecurityHeaders(
        new Response(body, {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/markdown; charset=utf-8",
            Vary: "Accept",
            "x-markdown-tokens": String(Math.ceil(body.length / 4)),
          },
        }),
        securityOptions
      );
    }

    const response = await paraglideMiddleware(request, () =>
      handler.fetch(request)
    );

    // The root document is the URL an agent probes first, so the discovery set
    // rides on it whether or not the client asked for Markdown.
    const document =
      dashboard && url.pathname === "/"
        ? withDiscoveryLink(response)
        : response;

    return applyPageSecurityHeaders(document, securityOptions);
  },
};

const withDiscoveryLink = (response: Response) => {
  const headers = new Headers(response.headers);
  headers.set("Link", DASHBOARD_DISCOVERY_LINK);

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

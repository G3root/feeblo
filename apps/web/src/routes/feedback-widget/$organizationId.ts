import {
  isSupportedLocale,
  type WidgetConfig,
  type WidgetModule,
  type WidgetMode,
} from "@feeblo/feedback-widget/config";
import { createFileRoute } from "@tanstack/react-router";

import {
  apiPreconnectOrigins,
  getBrowserPublicEnv,
  getPublicEnvServer,
} from "~/lib/server-runtime-public-env";

/**
 * The feedback widget's iframe document.
 *
 * A server-only route: it is pruned from the client route tree (no React
 * chunk, no Start runtime) and returns a hand-written HTML shell that loads
 * the independently built Solid bundle from `/widget`. That is what keeps the
 * iframe payload at the Astro-era size — the widget is a `HashRouter` SPA
 * with no hydration or data-loading needs of its own.
 *
 * In dev the shell points at the widget's own Vite server (port 5174), which
 * serves the same entry (`src/iframe-entry.tsx`) with HMR. The widget bundle
 * is built into `apps/web/public/widget` before the Start build, so
 * production serves it as a static asset from the same origin — cookies and
 * the `/api` proxy behave exactly as they did on the Astro iframe.
 */
export const Route = createFileRoute("/feedback-widget/$organizationId")({
  server: {
    handlers: {
      GET: ({ params, request }) => {
        const organizationId = params.organizationId;
        if (!organizationId) {
          return new Response("Not found", { status: 404 });
        }

        const url = new URL(request.url);
        const publicEnv = getBrowserPublicEnv();
        const noIndex = Boolean(getPublicEnvServer().NO_INDEX);

        const theme = url.searchParams.get("theme") ?? "light";
        const requestedLocale = url.searchParams.get("locale");
        const locale = isSupportedLocale(requestedLocale)
          ? requestedLocale
          : "en";
        const requestedMode = url.searchParams.get("mode");
        const mode: WidgetMode =
          requestedMode === "updates" || requestedMode === "hub"
            ? requestedMode
            : "feedback";
        const requestedModules = (url.searchParams.get("modules") ?? "")
          .split(",")
          .filter(
            (module): module is WidgetModule =>
              module === "feedback" || module === "updates"
          );
        const modules: WidgetModule[] =
          mode === "hub"
            ? [
                ...new Set(
                  requestedModules.length > 0
                    ? requestedModules
                    : (["feedback", "updates"] as const)
                ),
              ]
            : [mode];

        const widgetConfig: WidgetConfig = { mode, modules };
        const isDark = theme === "dark";

        const env = {
          ...publicEnv,
          organizationId,
          widgetConfig,
        };

        const isDev = import.meta.env.DEV;
        const assetOrigin = isDev ? "http://localhost:5174" : "";
        const scriptTags = isDev
          ? `<script type="module" src="${assetOrigin}/@vite/client"></script>
    <script type="module" src="${assetOrigin}/src/iframe-entry.tsx"></script>`
          : `<link rel="stylesheet" href="/widget/widget.css" />
    <script type="module" src="/widget/widget.js"></script>`;

        const preconnect = apiPreconnectOrigins()
          .map((origin) => `<link rel="preconnect" href="${origin}" />`)
          .join("\n    ");

        const html = `<!doctype html>
<html lang="${locale}" data-theme="${theme}"${isDark ? ' class="dark"' : ""}>
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>feeblo</title>
    ${noIndex ? '<meta name="robots" content="noindex, nofollow" />' : ""}
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    ${preconnect}
    <style>
      html,
      body {
        height: 100%;
        padding: 0;
        margin: 0;
      }
      [data-feeblo-widget-container] {
        min-height: 100%;
      }
    </style>
    <script>
      window.global = window.global || {};
      window.global.__ENV = ${JSON.stringify(env).replaceAll("<", "\\u003c")};
    </script>
    ${scriptTags}
  </head>
  <body>
    <div id="root"></div>
    <script>
      function notifyHeight() {
        requestAnimationFrame(() => {
          const height = document.documentElement.scrollHeight;
          if (window.parent !== window) {
            window.parent.postMessage(
              { event: "PAGE_HEIGHT", data: { height } },
              "*"
            );
          }
        });
      }

      window.addEventListener("load", notifyHeight);
      window.addEventListener("resize", notifyHeight);
    </script>
  </body>
</html>`;

        return new Response(html, {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            // The shell embeds the organization id and the widget config, so
            // it must not be cached across tenants.
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});

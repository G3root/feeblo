import { getClientHintCheckScript } from "@feeblo/web-shared/client-hints";
import interLatinFontUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import {
  createRootRouteWithContext,
  HeadContent,
  ScriptOnce,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, type ReactNode } from "react";

import {
  authHintScript,
  envScript,
  localeScript,
  themeScript,
} from "@/lib/pre-hydration-scripts";
import { getLocale, getTextDirection } from "@/paraglide/runtime.js";
import { RouteNotFoundPage } from "~/components/route-not-found-page";
import {
  apiPreconnectOrigins,
  getBrowserPublicEnv,
  getPublicEnvServer,
} from "~/lib/server-runtime-public-env";

import type { RouterContext } from "../router";

import "../styles/global.css";

/**
 * The document every route renders inside.
 *
 * `shellComponent` (rather than a component around `<Outlet />`) is Start's
 * document pattern: the shell renders once and route content hydrates into
 * it, so `html`/`head` are never recreated by a navigation.
 *
 * The pre-hydration scripts (`ScriptOnce`) replace the Astro layout's
 * `ThemeScript`/`LocaleScript`/`EnvScript` includes: theme and locale must be
 * applied before first paint, and `window.global.__ENV` must exist before the
 * client entry reads it. `authHintScript` has no Astro counterpart — the old
 * layouts painted a server-verified hint into a client-only app, and this is
 * its replacement now that the board's document is server-rendered and
 * shared. The env and locale values come from the root loader, which is a
 * server function — on Workers env is request-scoped, so it cannot be read at
 * module scope.
 *
 * In dev the stylesheet is linked directly: Vite serves the compiled sheet at
 * `/src/styles/global.css` for a plain `<link>` request, so the first paint is
 * fully styled and stable. This replaces Start's `dev.ssrStyles` aggregation,
 * which served a nondeterministic blend that broke the responsive cascade (see
 * `vite.config.ts`); in production the bundler emits the same sheet as an
 * asset linked by `HeadContent`.
 *
 * The dashboard is client-only (`/_dashboard` is `ssr: false`), so its routes
 * render after hydration behind `DashboardPendingShell`. The public board
 * renders its metadata on the server and hands the SPA over to the client.
 *
 * Inter's Latin subset is preloaded rather than discovered: the `@font-face`
 * that names it lives in the render-blocking stylesheet, so without the hint
 * the browser cannot start the font request until the CSS has parsed, and the
 * first paint swaps a fallback for it. Only the Latin pair is hinted — it is
 * the one subset a Latin-script page fetches, and preloading the other six
 * would put ~200 kB of never-used woff2 on the critical path. Geist Mono is
 * deliberately not preloaded: it is the code face and never paints above the
 * fold, so its swap costs nothing worth a blocking request.
 */
const getRootDocumentData = createServerFn({ method: "GET" }).handler(() => ({
  env: getBrowserPublicEnv(),
  noIndex: Boolean(getPublicEnvServer().NO_INDEX),
  preconnectOrigins: apiPreconnectOrigins(),
}));

export const Route = createRootRouteWithContext<RouterContext>()({
  loader: () => getRootDocumentData(),
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "UTF-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: "feeblo" },
      ...(loaderData?.noIndex
        ? [{ name: "robots", content: "noindex, nofollow" }]
        : []),
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      // `crossOrigin` is required to match the CORS-mode request the
      // `@font-face` load makes; without it the preload warms a different
      // cache entry and the browser fetches the file twice.
      {
        rel: "preload",
        href: interLatinFontUrl,
        as: "font",
        type: "font/woff2",
        crossOrigin: "anonymous",
      },
      ...(loaderData?.preconnectOrigins ?? []).map((origin) => ({
        rel: "preconnect",
        href: origin,
      })),
    ],
  }),
  notFoundComponent: RouteNotFoundPage,
  shellComponent: RootDocument,
});

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  const { env } = Route.useLoaderData();
  const clientHintCheckScript = getClientHintCheckScript();

  // `suppressHydrationWarning` covers this element only: the inline
  // pre-hydration scripts below (theme, locale) write `class`/`lang`/`dir` on
  // `<html>` while the document parses, so React's client render — whose
  // `<html>` carries no `className` — must not diff the server's HTML against
  // them. The alternative (server-rendering those attributes) is impossible:
  // `prefers-color-scheme` and the locale cookie are browser-only, and the
  // document is CDN-cached precisely because of that. Every deeper mismatch
  // (route content) still fails loudly; this suppresses the one element the
  // scripts legitimately mutate before React hydrates.
  return (
    <html lang={getLocale()} dir={getTextDirection()} suppressHydrationWarning>
      <head>
        {import.meta.env.DEV ? (
          <link rel="stylesheet" href="/src/styles/global.css" />
        ) : null}
        <HeadContent />
        <ScriptOnce children={clientHintCheckScript} />
        <ScriptOnce children={authHintScript()} />
        <ScriptOnce children={envScript(env)} />
        <ScriptOnce children={themeScript} />
        <ScriptOnce children={localeScript()} />
      </head>
      <body>
        {children}
        <HydrationMarker />
        <Scripts />
      </body>
    </html>
  );
}

/**
 * Marks the document as hydrated.
 *
 * React runs effects only after its hydration pass, so this attribute flips
 * exactly when the server-rendered tree became interactive. The e2e suite
 * waits on it instead of racing the first click; nothing in the app reads it.
 */
function HydrationMarker() {
  useEffect(() => {
    document.documentElement.dataset.hydrated = "true";
  }, []);

  return null;
}

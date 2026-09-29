import { getClientHintCheckScript } from "@feeblo/web-shared/client-hints";
import {
  createRootRouteWithContext,
  HeadContent,
  ScriptOnce,
  Scripts,
} from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useEffect, type ReactNode } from "react";

import {
  envScript,
  localeScript,
  themeScript,
} from "@/lib/pre-hydration-scripts";
import { getLocale, getTextDirection } from "@/paraglide/runtime.js";
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
 * client entry reads it. The values come from the root loader, which is a
 * server function — on Workers env is request-scoped, so it cannot be read at
 * module scope.
 *
 * The dashboard is client-only (`/_dashboard` is `ssr: false`), so its routes
 * render after hydration behind `DashboardPendingShell`. The public board
 * renders its metadata on the server and hands the SPA over to the client.
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
      ...(loaderData?.preconnectOrigins ?? []).map((origin) => ({
        rel: "preconnect",
        href: origin,
      })),
    ],
  }),
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
        <HeadContent />
        <ScriptOnce children={clientHintCheckScript} />
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

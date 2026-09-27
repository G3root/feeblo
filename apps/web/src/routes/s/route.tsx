import { AuthDialogProvider } from "@feeblo/post-ui/dialog-stores";
import { initPostUiI18n, isPostUiI18nInitialized } from "@feeblo/post-ui/i18n";
import {
  initPublicBoardI18n,
  isPublicBoardI18nInitialized,
  preloadBoardShell,
  setBoardOrganizationId,
} from "@feeblo/public-feature-board";
import { PublicBoardPending } from "@feeblo/public-feature-board/components/pending";
import { PublicBoardShell } from "@feeblo/public-feature-board/components/shell";
import { SiteProvider } from "@feeblo/public-feature-board/providers/site-provider";
import {
  getSsoTokenFromHash,
  removeSsoTokenFromHash,
} from "@feeblo/public-feature-board/sso-token";
import { AnchoredToastProvider, ToastProvider } from "@feeblo/ui/toast";
import { authClient } from "@feeblo/web-shared/auth-client";
import { AuthProvider } from "@feeblo/web-shared/auth-context";
import {
  getAuthSession,
  refreshAuthSession,
} from "@feeblo/web-shared/auth-session";
import {
  changelogJsonLd,
  postJsonLd,
  websiteJsonLd,
  type JsonLdNode,
} from "@feeblo/web-shared/json-ld";
import { useDbClient } from "@tanstack/react-db";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createFileRoute,
  notFound,
  Outlet,
  redirect,
} from "@tanstack/react-router";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { useEffect } from "react";

import { getPublicBoardPage } from "@/lib/public-board-data";
import { getLocale, setLocale } from "@/paraglide/runtime.js";

const LOCALE_COOKIE_NAME = "PARAGLIDE_LOCALE";

/**
 * The document's cache policy.
 *
 * A public board document is visitor-independent only while the visitor has
 * not chosen a locale: the server resolves the locale from the same cookie the
 * client uses, so a cookie-bearing request renders (and must therefore cache)
 * per locale, while a cookie-less document is identical for every visitor and
 * safe to share. Per-user state never reaches this document — auth and the
 * user-scoped collections resolve on the client.
 *
 * Set from the route's `headers`, not a loader: during SSR the loader runs
 * inside the page request, so the route's own headers are what shape the
 * document, and a status set from a loader would be interpreted by the RPC
 * layer instead.
 */
const getDocumentCacheControl = createIsomorphicFn()
  .client(() => undefined)
  .server(() => {
    const cookieHeader = getRequest().headers.get("cookie") ?? "";
    const hasLocaleCookie = cookieHeader
      .split(";")
      .some((entry) => entry.trim().startsWith(`${LOCALE_COOKIE_NAME}=`));

    return hasLocaleCookie
      ? "private, max-age=0, must-revalidate"
      : "public, s-maxage=60, stale-while-revalidate=300";
  });

/**
 * The public URL of the current page.
 *
 * A router location is internal (`/s/p/hello` on a board host) and its `href`
 * is relative, so the loader cannot rebuild the site's host from it. The
 * request's own URL is the public one on the server; the browser's location is
 * on the client.
 */
const currentUrl = createIsomorphicFn()
  .client(() => window.location.href)
  .server(() => getRequest().url);

/**
 * The public board's layout: site resolution, per-page metadata, and the shell
 * every board page renders inside.
 *
 * Board hosts rewrite their public paths onto this route
 * (`lib/public-board-rewrite`), so a visitor's `/p/hello` renders here as
 * `/s/p/hello` internally — links and history keep the public spelling. The
 * layout resolves the site and the page's detail content on the server so
 * `head()` can write the document's title, description, canonical link and
 * JSON-LD into the raw response, and fills the board's request scope before
 * any collection materializes.
 */
export const Route = createFileRoute("/s")({
  beforeLoad: async ({ context }) => {
    const page = await getPublicBoardPage({ data: { url: currentUrl() } });

    if (page.kind === "redirect") {
      // A merged source moves to its survivor, but unmerging is a supported
      // action: a permanent 301 would keep sending inbound links to the
      // survivor after the merge is reverted, so this is a temporary redirect
      // that proxies and browsers must not cache.
      throw redirect({
        href: page.to,
        statusCode: 302,
        headers: { "Cache-Control": "no-store" },
      });
    }

    if (page.kind === "not-found") {
      // Missing or hidden detail content: a hard 404 keeps crawlers (and
      // visitors) off URLs that would otherwise render a not-found state
      // behind a 200.
      throw notFound();
    }

    if (page.kind === "rpc-unavailable") {
      // A downstream RPC failure must not 500 a public page: the shell renders
      // a noindex "Content unavailable" document and the client can retry.
      return { boardPage: page, preloadDegraded: true };
    }

    // The scope must be filled before any collection materializes, and this
    // runs before every child route's `beforeLoad`/`loader`.
    setBoardOrganizationId(context.dbClient, page.site.organizationId);

    const outcome = await preloadBoardShell(context.dbClient);

    return { boardPage: page, preloadDegraded: outcome.degraded };
  },
  headers: ({ match }) => {
    const cacheControl = getDocumentCacheControl();

    if (!cacheControl) {
      return undefined;
    }

    return {
      "Cache-Control":
        match.context.boardPage.kind === "found" &&
        !match.context.preloadDegraded
          ? cacheControl
          : "no-store",
    };
  },
  head: ({ match }) => {
    const { boardPage } = match.context;

    if (boardPage.kind !== "found") {
      return {
        meta: [
          { title: "Content unavailable" },
          { name: "robots", content: "noindex, nofollow" },
        ],
      };
    }

    const { site, post, changelog, canonicalUrl, siteUrl, ogImageUrl } =
      boardPage;
    const jsonLd: JsonLdNode[] = [
      websiteJsonLd({ name: site.name, url: siteUrl }),
    ];
    let pageTitle = `${site.name} — Feedback and roadmap`;
    let pageDescription = `Share feedback, follow the roadmap, and read product updates from ${site.name}.`;

    if (post) {
      pageTitle = `${post.title} — ${site.name}`;
      pageDescription = post.excerpt;
      jsonLd.push(
        postJsonLd({
          headline: post.title,
          description: post.excerpt,
          url: canonicalUrl,
          datePublished: post.createdAt,
          dateModified: post.updatedAt,
          authorName: post.user.name,
        })
      );
    } else if (changelog) {
      pageTitle = `${changelog.title} — ${site.name} changelog`;
      pageDescription = changelog.excerpt;
      jsonLd.push(
        changelogJsonLd({
          headline: changelog.title,
          description: changelog.excerpt,
          url: canonicalUrl,
          datePublished: changelog.publishedAt ?? changelog.createdAt,
          dateModified: changelog.updatedAt,
          authorName: changelog.user.name,
        })
      );
    }

    return {
      meta: [
        { title: pageTitle },
        { name: "description", content: pageDescription },
        ...(boardPage.noIndex || match.context.preloadDegraded
          ? [{ name: "robots", content: "noindex, nofollow" }]
          : []),
        { property: "og:title", content: pageTitle },
        { property: "og:description", content: pageDescription },
        { property: "og:type", content: "website" },
        { property: "og:url", content: canonicalUrl },
        { property: "og:image", content: ogImageUrl },
        { property: "og:image:type", content: "image/png" },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { property: "og:image:alt", content: `${pageTitle} social preview` },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: pageTitle },
        { name: "twitter:description", content: pageDescription },
        { name: "twitter:image", content: ogImageUrl },
        { name: "twitter:image:alt", content: `${pageTitle} social preview` },
      ],
      links: [
        { rel: "canonical", href: canonicalUrl },
        ...(site.changelogVisibility === "PUBLIC"
          ? [
              {
                rel: "alternate",
                href: "/changelog/rss.xml",
                title: `${site.name} changelog`,
                type: "application/rss+xml",
              },
            ]
          : []),
      ],
      scripts: jsonLd.map((node) => ({
        type: "application/ld+json",
        children: JSON.stringify(node)
          .replaceAll("<", "\\u003c")
          .replaceAll(">", "\\u003e")
          .replaceAll("&", "\\u0026"),
      })),
    };
  },
  pendingComponent: PublicBoardPending,
  component: BoardLayout,
});

/**
 * The board's locale runtime.
 *
 * The board compiles its own messages with the `baseLocale` fallback strategy
 * and must never detect the locale itself; the host's cookie-based runtime is
 * injected here. Idempotent, and safe to call per render: the override
 * delegates to a function that resolves the request's locale, so one installed
 * override serves every request.
 */
function initBoardI18n() {
  if (!isPostUiI18nInitialized()) {
    initPostUiI18n({ getLocale, setLocale });
  }

  if (!isPublicBoardI18nInitialized()) {
    initPublicBoardI18n({ getLocale, setLocale });
  }
}

/**
 * Consumes an SSO token from the URL fragment.
 *
 * The token never reaches the server (it lives in the fragment) and the
 * session is resolved client-side, so the exchange happens after mount: the
 * server renders the anonymous board and the visitor upgrades to their
 * restricted session a moment later. The token is stripped from history
 * immediately so a refresh cannot replay it.
 */
function useBoardSsoToken(organizationId: string | undefined) {
  useEffect(() => {
    if (!organizationId) {
      return;
    }

    const url = new URL(window.location.href);
    const token = getSsoTokenFromHash(url.hash);

    if (token !== null) {
      url.hash = removeSsoTokenFromHash(url.hash);
      window.history.replaceState(window.history.state, "", url);
    }

    void (async () => {
      const session = await getAuthSession();
      const restrictedToOrganizationId =
        session?.user.restrictedToOrganizationId;

      if (
        restrictedToOrganizationId &&
        restrictedToOrganizationId !== organizationId
      ) {
        // A session restricted to another board must not act here.
        await authClient.signOut();
        await refreshAuthSession();
        return;
      }

      if (
        token !== null &&
        session?.user.restrictedToOrganizationId !== organizationId
      ) {
        const result = await authClient.signIn.jwtAutoLogin({
          organizationId,
          token,
        });

        if (result.error) {
          // Staying signed out is the safe outcome for a rejected token; the
          // visitor can still use the regular sign-in dialog.
          return;
        }

        await refreshAuthSession();
      }
    })().catch(() => undefined);
  }, [organizationId]);
}

function BoardLayout() {
  const { boardPage, queryClient } = Route.useRouteContext();
  const dbClient = useDbClient();

  initBoardI18n();

  const organizationId =
    boardPage.kind === "found" ? boardPage.site.organizationId : undefined;

  // Hydration does not re-run `beforeLoad`, so the scope is re-published from
  // the route's data here. A parent renders before its children, so every
  // collection materialized below reads a filled scope.
  setBoardOrganizationId(dbClient, organizationId);
  useBoardSsoToken(organizationId);

  if (boardPage.kind !== "found") {
    return <BoardUnavailablePage />;
  }

  return (
    <AuthProvider hydrationSafe>
      <AuthDialogProvider>
        {/* The board's RPC-backed collections own their QueryClient, but
            `post-ui` surfaces (notifications, suggestions) read cache state
            through react-query hooks, so the same client is provided here. */}
        <QueryClientProvider client={queryClient}>
          <SiteProvider site={boardPage.site}>
            {/* Anchored toasts render the subscribe feedback next to the
                toggle; global toasts surface persistence failures. */}
            <ToastProvider>
              <AnchoredToastProvider>
                <PublicBoardShell>
                  <Outlet />
                </PublicBoardShell>
              </AnchoredToastProvider>
            </ToastProvider>
          </SiteProvider>
        </QueryClientProvider>
      </AuthDialogProvider>
    </AuthProvider>
  );
}

function BoardUnavailablePage() {
  return (
    <main className="flex min-h-[70vh] items-center justify-center">
      <p className="text-muted-foreground text-sm">Content unavailable</p>
    </main>
  );
}

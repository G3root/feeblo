# Server-rendering the public board

Implemented on `feat/public-page-ssr`. The board's pages are now routes of the host TanStack Start app, server-rendered from TanStack DB collections and hydrated with the state the render already fetched.

## What changed

**The host owns the board's routes.** `apps/web/src/routes/s/**` holds the layout (`route.tsx`: site resolution, per-page metadata, the shell) plus the pages (`index`, `b/$boardSlug`, `roadmap/…`, `changelog/…`, `p/$slug`, `$`). `@feeblo/public-feature-board` keeps the pages, components, collections and i18n; its nested router, `PublicBoardApp`, the `ClientOnly` island, the spinner fallback, the type-stub boundary and the Vite alias are gone. Board links use the router's internal `/s/...` spelling (`lib/board-links.ts`); the host's rewrite hides it from visitors.

**Collections are request-scoped descriptors.** Every collection is a `collectionOptions(id, (client) => …)` descriptor whose dependencies come from the `DbClient` (`lib/board-scope.ts`: the hosting organization, the viewed slug, the request's `QueryClient`). One `DbClient` is built per request in `getRouter()`, and `routerWithDbClient` dehydrates it into the document and hydrates it in the browser. The board fills the scope in the layout's `beforeLoad` (before any child loader) and again during the layout's render, because hydration does not re-run `beforeLoad`.

**Preloads.** The layout preloads the shell's collections (boards, posts, statuses, upvotes) as normalized rows, so every projection a page runs over them re-derives from the hydrated rows. Roadmap and changelog routes add their own; the changelog _detail_ route preloads the exact query the page renders, because a live-query snapshot is keyed by query identity. Preloads are bounded on the server (`settlePreloads`): a slow or failing API degrades the document (noindex, client finishes the load) instead of holding the request open.

**Caching.** Documents are shared-cacheable exactly while they are visitor-independent: `public, s-maxage=60, stale-while-revalidate=300` when the request carries no locale cookie, `private, max-age=0, must-revalidate` when it does, and `no-store` when the render was degraded. No `Vary` is needed — the host resolves the locale from the cookie alone (`["cookie","baseLocale"]`), so a cookie-less document is identical for every visitor.

**Anonymous server render.** The server never reads a session: `getCachedAuthSession()` answers `null` outside the browser, user-scoped collections (subscriptions, delete hints) load after mount, and the SSO fragment exchange moved from the root `beforeLoad` into a client effect. The board's `AuthProvider` is mounted with `hydrationSafe`, which defers the display hint cookie to after mount so the first client render matches the server's signed-out markup.

## Two things that bite

**`isLoading` is not "no content".** Hydration installs rows _before_ the first browser render, but a collection only reports `ready` once its adapter's first sync resolves — so a skeleton gated on `isLoading` replaces server-rendered content with a placeholder and React regenerates the tree (mismatch, and a flash of the wrong UI). Use `isLiveQueryPending` from `@feeblo/web-shared/collections` instead: a query with a result — including an empty list, or a `.findOne()` that matched nothing — is content. Only a query with no result that is still starting is pending, and a disabled query never is (it asked for nothing).

**On-demand subsets do not hydrate.** `syncMode: "on-demand"` collections load rows only while something subscribes; their rows are not part of the dehydrated state, and their live-query snapshots only hydrate for a query with the same identity. The board's on-demand surfaces are: post detail, comments, reactions, upvotes, tags, subscriptions. That is why `/s/p/$slug` is `ssr: false` (as it effectively was before, when the whole board was client-rendered): the layout still server-renders the site, the post's metadata and its JSON-LD for crawlers, and the body renders on the client. Turning it on needs subsets that hydrate by identity.

## Verification

- Unit: `apps/public-feature-board/test/board-scope.test.ts` (per-scope isolation, slug resolution) and `collections.test.ts` (descriptor materialization and indexes on a real `DbClient`).
- e2e: board pages assert their _raw_ HTML (crawler view) and then hydrate; `helpers/hydration.ts` waits for the root shell's `data-hydrated` marker before interacting, because a click can otherwise land before React attaches its handlers — the pre-SSR tests never had that window.
- `pnpm lint`, `pnpm fmt:check`, `tsc --noEmit` for `apps/web`, `apps/public-feature-board`, `packages/web-shared`, `packages/post-ui`, `e2e`; `pnpm test`; `pnpm test:e2e`.

## Follow-ups

- Server-render `/p/:slug` once on-demand subsets hydrate by identity.
- `@tanstack/query-db-collection` has no sync metadata, so the browser re-runs every `queryFn` after hydration; dehydrating the TanStack Query cache would remove that refetch.
- The dashboard is still `ssr: false`; the per-request `QueryClient` identity it needs is already in place.

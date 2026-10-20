import {
  COLLECTION_CONTEXT_DEPENDENCY,
  COLLECTION_QUERY_CLIENT_DEPENDENCY,
  createCollectionContext,
} from "@feeblo/web-shared/collection-context";
import {
  firstPathSegment,
  postSlugFromPath,
} from "@feeblo/web-shared/collections";
import { DbClient } from "@tanstack/react-db";
import type { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * The current-pathname accessor for the slug-scoped collections.
 *
 * Both surfaces resolve "which post/changelog entry am I on" from the URL,
 * because their query keys are built lazily (from a subset request, not from a
 * route). The browser reads the live location, since one client spans
 * navigations; the server *captures* the request's pathname while the router is
 * being built, because context lookups also run after the render (subset
 * unloading, collection cleanup) where no request context exists — and it is
 * the visitor's public spelling, which is what `postSlugFromPath` expects.
 */
const getPagePathname = createIsomorphicFn()
  .client(() => () => window.location.pathname)
  .server(() => {
    const { pathname } = new URL(getRequest().url);
    return () => pathname;
  });

/**
 * The collection context for this document or request.
 *
 * The slugs come from the URL at query time. The organization comes from the
 * committed URL too: its organization route clears any value the board published, so a
 * dashboard document never inherits a board's organization, and a navigation
 * scopes collections to the new organization only after the URL commits.
 *
 * The app serves two URL shapes. A dashboard post lives at
 * `/:organizationId/…/post/:boardSlug/:postSlug`; a public post at `/p/:slug`,
 * whose internal `/s` prefix may already be rewritten away on the server. The
 * dashboard shape is tried first, and the fallback only resolves on a board
 * document, where no `post` segment exists.
 */
function createPageContext() {
  const pathname = getPagePathname();

  return createCollectionContext({
    getChangelogSlug: () => postSlugFromPath(pathname(), "changelog", 1),
    getOrganizationId: () => firstPathSegment(pathname()),
    getPostSlug: () =>
      postSlugFromPath(pathname(), "post", 2) ??
      postSlugFromPath(pathname(), "p", 1),
  });
}

/**
 * One `DbClient` per app instance in the browser, one per request on the
 * server.
 *
 * A module-level singleton is the model the TanStack DB SSR guide describes for
 * the browser, and it is wrong on the server: a Worker isolate serves many
 * requests, so the first request's client — and with it its `QueryClient`,
 * materialized collections, and hydrated rows — would be handed to the next
 * request. The server keys the client on the request object instead, which is
 * stable for the life of a request and collectable once it ends.
 *
 * The client carries the page's collection context, and both the board's
 * descriptors and the dashboard's collection accessor read it from the same
 * instance. One client means `useDbClient()`, the board's `beforeLoad`, and the
 * dashboard's `dashboardCollections` accessor cannot end up with three clients
 * and three copies of every row.
 *
 * The `QueryClient` arrives as a thunk so a cache hit never builds one:
 * `getContext()` creates a fresh `QueryClient` on every server call.
 *
 * `getRequest` is reached only from the `.server()` branch, which is what lets
 * the Start build strip the import from the client bundle — importing
 * `@tanstack/react-start/server` unconditionally is rejected by the
 * `tanstack-start-core:import-protection` plugin.
 */
export const getDbClient = createIsomorphicFn()
  .client((getQueryClient: () => QueryClient): DbClient => {
    browserDbClient ??= new DbClient({
      [COLLECTION_QUERY_CLIENT_DEPENDENCY]: getQueryClient(),
      [COLLECTION_CONTEXT_DEPENDENCY]: createPageContext(),
    });

    return browserDbClient;
  })
  .server((getQueryClient: () => QueryClient): DbClient => {
    const request = getRequest();
    const existing = requestDbClients.get(request);

    if (existing) {
      return existing;
    }

    const client = new DbClient({
      [COLLECTION_QUERY_CLIENT_DEPENDENCY]: getQueryClient(),
      [COLLECTION_CONTEXT_DEPENDENCY]: createPageContext(),
    });
    requestDbClients.set(request, client);

    return client;
  });

/** Browser app instance client; see the note above. */
let browserDbClient: DbClient | null = null;

/** Per-request clients, keyed by the request they belong to. */
const requestDbClients = new WeakMap<Request, DbClient>();

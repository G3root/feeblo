import {
  BOARD_QUERY_CLIENT_DEPENDENCY,
  BOARD_SCOPE_DEPENDENCY,
  createBoardScope,
} from "@feeblo/public-feature-board/board-scope";
import { DbClient } from "@tanstack/react-db";
import type { QueryClient } from "@tanstack/react-query";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * The current-pathname accessor for the public board's slug scope.
 *
 * The board's collections resolve "which post/changelog entry am I on" from the
 * URL, because their query keys are built lazily (from a subset request, not
 * from a route). The browser reads the live location, since one client spans
 * navigations; the server *captures* the request's pathname while the router is
 * being built, because scope lookups also run after the render (subset
 * unloading, collection cleanup) where no request context exists — and it is
 * the visitor's public spelling, which is what `postSlugFromPath` expects.
 */
const getBoardPathname = createIsomorphicFn()
  .client(() => () => window.location.pathname)
  .server(() => {
    const { pathname } = new URL(getRequest().url);
    return () => pathname;
  });

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
 * The client carries the board's scope dependencies, and the dashboard's
 * collection descriptors read their `QueryClient` from the same instance. One
 * client means `useDbClient()`, the board's `beforeLoad`, and the dashboard's
 * `dashboardCollections` accessor cannot end up with three clients and three
 * copies of every row.
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
      [BOARD_QUERY_CLIENT_DEPENDENCY]: getQueryClient(),
      [BOARD_SCOPE_DEPENDENCY]: createBoardScope({
        pathname: getBoardPathname(),
      }),
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
      [BOARD_QUERY_CLIENT_DEPENDENCY]: getQueryClient(),
      [BOARD_SCOPE_DEPENDENCY]: createBoardScope({
        pathname: getBoardPathname(),
      }),
    });
    requestDbClients.set(request, client);

    return client;
  });

/** Browser app instance client; see the note above. */
let browserDbClient: DbClient | null = null;

/** Per-request clients, keyed by the request they belong to. */
const requestDbClients = new WeakMap<Request, DbClient>();

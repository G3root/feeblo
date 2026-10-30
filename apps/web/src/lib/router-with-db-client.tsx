import {
  DbProvider,
  type DbClient,
  type DehydratedDbState,
} from "@tanstack/react-db";
import type { AnyRouter } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

/**
 * The DB state this router carries across the server/client boundary.
 *
 * Deliberately only the client's dehydrate/hydrate payload: the live-query
 * *stream* that `@tanstack/react-router-with-db` adds alongside it is not part
 * of this integration. See `withDbClient` for why.
 */
export type DehydratedRouterDbState = {
  dehydratedDbClient: DehydratedDbState;
};

/**
 * Wires one `DbClient` into the router: it is provided through `DbProvider` so
 * `useLiveQuery`/`useDbClient` resolve against it, and its dehydrated state
 * crosses the server/client boundary with the router's own.
 *
 * This replaces `@tanstack/react-router-with-db`. That adapter is otherwise
 * identical — same `Wrap`, same dehydrate/hydrate — but it also enables the
 * live-query stream handshake, and in TanStack DB 1.0 that handshake is fatal
 * for any query whose identity the server did not dehydrate. Closing the stream
 * records a sticky failure (error 253), and from then on every hydration read
 * of a live query that is not in the hydrated set throws inside React's render.
 *
 * A query that is not immediately runnable — every per-viewer query on the
 * public board, which returns `undefined` to disable itself until a session
 * resolves — can never be in that set, because the server never ran it. Those
 * queries are the reason this integration exists.
 *
 * Nothing is lost by dropping the stream. It exists to resolve
 * `useLiveSuspenseQuery` results discovered during the server render (see the
 * adapter's README); this app uses `useLiveQuery` throughout, and every
 * rendered query is already captured by the dehydrate below. Queries that
 * appear only after hydration read their source collections, which are the
 * rows this payload restores.
 */
export function withDbClient<TRouter extends AnyRouter>(
  router: TRouter,
  dbClient: DbClient
): TRouter {
  const originalOptions = router.options;

  router.options = {
    ...router.options,
    Wrap: ({ children }: { children: ReactNode }) => {
      const OriginalWrap = originalOptions.Wrap ?? Fragment;

      return (
        <DbProvider client={dbClient}>
          <OriginalWrap>{children}</OriginalWrap>
        </DbProvider>
      );
    },
  };

  if (router.isServer) {
    router.options.dehydrate = async () => ({
      ...(await originalOptions.dehydrate?.()),
      dehydratedDbClient: dbClient.dehydrate(),
    });

    return router;
  }

  router.options.hydrate = async (dehydrated: DehydratedRouterDbState) => {
    // Before the router renders, so the first client render reads the rows the
    // server already fetched. Reversing these would reintroduce the loading
    // pass the dehydrate exists to remove.
    dbClient.hydrate(dehydrated.dehydratedDbClient);
    await originalOptions.hydrate?.(dehydrated);
  };

  return router;
}

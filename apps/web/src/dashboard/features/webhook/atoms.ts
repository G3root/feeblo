import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { loadDeliveries, loadEndpoints } from "./lib/endpoints";

export type Endpoint = Awaited<ReturnType<typeof loadEndpoints>>[number];
export type DeliveryPage = Awaited<ReturnType<typeof loadDeliveries>>;
export type Delivery = DeliveryPage["items"][number];

/**
 * Client-side source of truth for the webhook pages.
 *
 * Endpoint lists and delivery history are Effect atoms whose results stream
 * into React through `useAtomValue` from `@effect/atom-react`. Mutations
 * refresh `endpointsAtom` after they succeed so the visible list stays in
 * sync with the RPC.
 */
export const webhookAtomRegistry = AtomRegistry.make();

/**
 * The endpoint list of one organization, one cached atom per organization id.
 * `Atom.family` memoizes the atom instance so the list page, the edit sheet,
 * and the detail page share a single node: a refresh from any of them updates
 * every reader.
 */
export const endpointsAtom = Atom.family((organizationId: string) =>
  Atom.make(Effect.tryPromise(() => loadEndpoints(organizationId))).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnFocus: "always",
      focusSignal: Atom.windowFocusSignal,
    }),
    Atom.setIdleTTL("5 minutes")
  )
);

export type DeliveryHistoryArgs = {
  readonly organizationId: string;
  readonly connectionId: string;
};

/**
 * Bumping this counter restarts the delivery-history stream for one connection
 * from the newest page. It is read as a dependency inside `deliveriesAtom`'s
 * pull, so any write re-runs that stream from scratch — the same dependency
 * reactivity the reference app gets from reading the query atom. The Refresh
 * button, test deliveries, and retries all bump it.
 *
 * The atom is a per-connection family (like `deliveriesAtom`) so a refresh of
 * one connection never restarts another connection's stream.
 */
export const deliveryHistoryRefreshAtom = Atom.family(
  (args: DeliveryHistoryArgs) =>
    Atom.writable<number, void>(
      () => 0,
      (ctx, _) => {
        ctx.setSelf(ctx.get(deliveryHistoryRefreshAtom(args)) + 1);
      }
    )
);

/**
 * The full delivery history of one connection, streamed page by page.
 *
 * `Atom.pull` owns all the paging state: the first page loads as soon as the
 * atom is read, each write to the atom pulls the next page, and items
 * accumulate across pulls. The stream ends on the page whose `nextCursor` is
 * null, after which a pull reports `done: true`. Writing `undefined` (e.g.
 * `useAtomSet`) advances one page; refreshing restarts the stream from the
 * newest page.
 */
export const deliveriesAtom = Atom.family((args: DeliveryHistoryArgs) =>
  Atom.pull((get) => {
    get(deliveryHistoryRefreshAtom(args));
    return Stream.paginate(undefined as string | undefined, (cursor) =>
      Effect.tryPromise(() =>
        loadDeliveries(args.organizationId, args.connectionId, cursor)
      ).pipe(
        Effect.map(
          (page) => [page.items, Option.fromNullishOr(page.nextCursor)] as const
        )
      )
    );
  }).pipe(Atom.keepAlive)
);

/** True while `deliveriesAtom` is fetching the next page. */
export const deliveriesLoadingAtom = Atom.family((args: DeliveryHistoryArgs) =>
  Atom.map(deliveriesAtom(args), (_) => _.waiting)
);

/**
 * Writing a connection pair warms `deliveriesAtom` for it. The endpoint list
 * sets this on pointer-down of the "Details" link, so the first page of
 * delivery history is already fetched by the time the detail route mounts
 * (same preload-in-link pattern as the reference search app).
 */
export const preloadDeliveryHistoryAtom = Atom.fnSync(
  (args: DeliveryHistoryArgs, get) => {
    get(deliveriesAtom(args));
  }
);

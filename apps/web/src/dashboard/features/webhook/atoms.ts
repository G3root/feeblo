import * as Effect from "effect/Effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";
import { loadDeliveries, loadEndpoints } from "./lib/endpoints";

export type Endpoint = Awaited<ReturnType<typeof loadEndpoints>>[number];
export type DeliveryPage = Awaited<ReturnType<typeof loadDeliveries>>;

/**
 * Client-side source of truth for the webhook pages.
 *
 * Endpoint lists and delivery-history pages are swr-cached Effect atoms whose
 * results stream into React through `useAtomValue` from `@effect/atom-react`.
 * Mutations refresh `endpointsAtom` after they succeed so the visible list
 * stays in sync with the RPC.
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

/**
 * One delivery-history page. The first page (`cursor === null`) loads as soon
 * as the atom mounts; later pages only load when the consumer refreshes the
 * atom, keeping paging user-driven instead of chaining every page ahead.
 */
export const deliveriesAtom = (
  organizationId: string,
  connectionId: string,
  cursor: string | null
) =>
  Atom.make(
    Effect.tryPromise(() =>
      loadDeliveries(organizationId, connectionId, cursor ?? undefined)
    )
  ).pipe(
    Atom.swr({
      staleTime: "30 seconds",
      revalidateOnMount: cursor === null,
    }),
    Atom.setIdleTTL("5 minutes")
  );

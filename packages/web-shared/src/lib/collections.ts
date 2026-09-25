/**
 * Shared infrastructure for TanStack DB collections backed by the RPC API.
 *
 * The dashboard (`apps/web`) and the public feature board
 * (`apps/public-feature-board`) define their own collections because they call
 * different RPCs (authenticated vs `*Public`) under different authorization
 * rules. What they share — query-key scoping, filter parsing, and post-slug
 * resolution — lives here so the two surfaces cannot drift apart.
 */

/** Minimal structural shape of the TanStack DB filters these helpers read. */
export interface CollectionEqFilter {
  field: ReadonlyArray<string | number>;
  operator: string;
  value?: unknown;
}

/**
 * App-provided routing context; each surface implements it against its own
 * URL scheme (dashboard routes carry the organization id in the pathname,
 * the embedded public board receives it through runtime env).
 */
export interface RpcCollectionRouteContext {
  /**
   * Organization id for the current surface, or undefined when unavailable
   * (e.g. during SSR).
   */
  getOrganizationId(): string | undefined;
  /**
   * Slug of the post detail page currently being viewed, or undefined outside
   * a post page. Lets slug-scoped collections (comments, reactions,
   * subscriptions) self-key when created without explicit filters, e.g. from
   * a route loader.
   */
  getPostSlug(): string | undefined;
}

/** Reads the string value of the first `eq` filter targeting `fieldName`. */
export function eqFilterValue(
  filters: ReadonlyArray<CollectionEqFilter>,
  fieldName: string
): string | undefined {
  for (const { field, operator, value } of filters) {
    if (operator === "eq" && field.join(".") === fieldName) {
      // SAFETY: The upstream contract guarantees a string here.
      return value as string;
    }
  }

  return undefined;
}

/**
 * Builds a query key scoped to `organizationId`. Without one the key falls
 * back to the bare scope so unscoped fetches stay cache-coherent between
 * server render and client hydration.
 */
export function organizationScopedKey(
  organizationId: string | undefined,
  scope: string,
  ...parts: ReadonlyArray<string | undefined>
): string[] {
  const key = organizationId ? [scope, organizationId] : [scope];

  for (const part of parts) {
    if (part) {
      key.push(part);
    }
  }

  return key;
}

/**
 * Extracts a post slug from a URL path of the shape
 * `/…/:markerSegment/…/:slug` where the slug sits `slugOffset` segments after
 * the marker (`/post/:boardSlug/:postSlug` on the dashboard, `/p/:slug` on the
 * public board). Returns undefined outside a post page or when the slug is
 * malformed percent-encoding, so callers fall back to an unscoped query
 * instead of crashing the route loader.
 */
export function postSlugFromPath(
  pathname: string,
  markerSegment: string,
  slugOffset: number
): string | undefined {
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const markerIndex = segments.indexOf(markerSegment);

  if (markerIndex === -1 || !segments[markerIndex + slugOffset]) {
    return undefined;
  }

  try {
    // SAFETY: The index bounds are checked by the surrounding condition.
    return decodeURIComponent(segments[markerIndex + slugOffset] as string);
  } catch {
    return undefined;
  }
}

export interface RpcCollectionHelpers {
  /** Query-key builder scoped to the current organization. */
  organizationScopedQueryKey(
    scope: string,
    ...parts: ReadonlyArray<string | undefined>
  ): string[];
  /** Effective postSlug: an explicit eq-filter wins over the route slug. */
  resolvePostSlug(
    filters?: ReadonlyArray<CollectionEqFilter>
  ): string | undefined;
  /**
   * Query key for a slug-scoped scope ("comment", "post-reaction", …).
   * Extra parts (e.g. a session user id for user-scoped data) are appended so
   * identity-specific results never share a cache entry across users.
   */
  slugScopedQueryKey(
    scope: string,
    filters?: ReadonlyArray<CollectionEqFilter>,
    ...parts: ReadonlyArray<string | undefined>
  ): string[];
}

/** Binds the pure helpers to a surface's routing context. */
export function createRpcCollectionHelpers(
  context: RpcCollectionRouteContext
): RpcCollectionHelpers {
  const organizationScopedQueryKey = (
    scope: string,
    ...parts: ReadonlyArray<string | undefined>
  ) => organizationScopedKey(context.getOrganizationId(), scope, ...parts);

  const resolvePostSlug = (filters?: ReadonlyArray<CollectionEqFilter>) =>
    eqFilterValue(filters ?? [], "postSlug") ?? context.getPostSlug();

  const slugScopedQueryKey = (
    scope: string,
    filters?: ReadonlyArray<CollectionEqFilter>,
    ...parts: ReadonlyArray<string | undefined>
  ) => {
    const slug = resolvePostSlug(filters);

    return slug
      ? organizationScopedQueryKey(scope, "postSlug", slug, ...parts)
      : organizationScopedQueryKey(scope, ...parts);
  };

  return { organizationScopedQueryKey, resolvePostSlug, slugScopedQueryKey };
}

/**
 * Refetch derived collections without blocking the mutation that triggered
 * them.
 *
 * Only the mutation's own collection belongs in an `await`: every refetch is
 * its own RPC round trip, so awaiting a secondary collection inside a
 * mutation handler holds the optimistic state open for the length of that
 * round trip. Secondary refetches run detached instead — the collection keeps
 * its current rows until the refetch lands, and a failure is contained
 * because the collection reports it through its own sync error state while
 * the settled mutation stays successful.
 *
 * Call sites still order correctly: start the refetch after the persisting
 * `fetchRpc` resolves, so the server has the write before the read-back.
 */
export function refetchInBackground(
  ...refetches: ReadonlyArray<Promise<unknown>>
): void {
  for (const refetch of refetches) {
    refetch.catch(() => undefined);
  }
}

/** Minimal structural view of a TanStack DB transaction. */
type SettleableTransaction = {
  isPersisted: { promise: Promise<unknown> };
};

/**
 * Starts an optimistic mutation whose UI has already moved on (the dialog
 * closed, the row was removed) and reports the outcome without blocking.
 *
 * `collection.delete`/`update` throw synchronously when the target row is no
 * longer in the collection, so the mutation creation is guarded too: both the
 * synchronous throw and a later persistence rejection route through `onError`
 * instead of an uncaught error or an unhandled rejection. Callers own the
 * rollback UX; the collection reverts the optimistic state on failure.
 */
export function settleOptimisticMutation(
  mutate: () => SettleableTransaction,
  onSuccess: (() => void) | undefined,
  onError: () => void
): void {
  let transaction: SettleableTransaction;

  try {
    transaction = mutate();
  } catch {
    onError();
    return;
  }

  void transaction.isPersisted.promise.then(onSuccess, onError);
}

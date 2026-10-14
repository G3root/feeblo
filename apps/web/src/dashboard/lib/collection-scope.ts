/**
 * Scope and identity rules for dashboard collections.
 *
 * Split out of `./collections` so the identity rules can be tested without the
 * RPC/schema module graph, and so the SSR follow-up has a single place to
 * change where a scope comes from.
 */

/**
 * Everything a dashboard collection's identity depends on.
 *
 * Descriptor ids must encode every parameter that changes the collection, so
 * that one `DbClient` can serve more than one scope without two tenants (or
 * two posts) sharing a collection. Today the scope is read from the URL; when
 * the dashboard moves onto SSR it comes from route context instead.
 */
export interface DashboardCollectionScope {
  organizationId: string | undefined;
  postSlug: string | undefined;
}

/**
 * Mirrors `organizationScopedKey`: an unscoped collection falls back to a bare
 * id rather than one keyed by `undefined`.
 */
export function organizationScopedCollectionId(
  name: string,
  scope: DashboardCollectionScope
): string {
  return scope.organizationId ? `${name}:${scope.organizationId}` : name;
}

/**
 * Mirrors `slugScopedQueryKey`: without a slug the collection falls back to the
 * org-scoped id.
 *
 * Slug-scoped collections are all `syncMode: "on-demand"`, and their `queryKey`
 * falls back to the route slug. A collection shared across posts would
 * re-resolve that fallback for subscribers still mounted on the previous post,
 * so the slug is part of the identity rather than a demand on a shared
 * collection.
 */
export function slugScopedCollectionId(
  name: string,
  scope: DashboardCollectionScope
): string {
  const base = organizationScopedCollectionId(name, scope);

  return scope.postSlug ? `${base}:${scope.postSlug}` : base;
}

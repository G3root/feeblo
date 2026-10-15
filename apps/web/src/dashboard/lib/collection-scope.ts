/**
 * Scope and identity rules for dashboard collections.
 *
 * Split out of `./collections` so the identity rules can be tested without the
 * RPC/schema module graph, and so the SSR follow-up has a single place to
 * change where a scope comes from.
 */
import {
  type CollectionEqFilter,
  eqFilterValue,
  organizationScopedKey,
} from "@feeblo/web-shared/collections";

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

/**
 * The key an organization-scoped collection caches under.
 *
 * Derived from the scope the collection was created for, never from the live
 * URL: a descriptor's id already encodes the scope, and a refetch that
 * outlives a route change — the awaited read-back in a mutation handler, a
 * background refetch started just before a workspace switch — would otherwise
 * key one organization's rows under another's organization.
 */
export function organizationScopedQueryKey(
  scope: DashboardCollectionScope,
  name: string,
  ...parts: ReadonlyArray<string | undefined>
): string[] {
  return organizationScopedKey(scope.organizationId, name, ...parts);
}

/**
 * The post slug a collection reads: an explicit `postSlug` filter wins over the
 * scope's slug. The scope's slug is the one captured when the descriptor was
 * created, not the route the browser happens to be on at fetch time.
 */
export function scopePostSlug(
  scope: DashboardCollectionScope,
  filters?: ReadonlyArray<CollectionEqFilter>
): string | undefined {
  return eqFilterValue(filters ?? [], "postSlug") ?? scope.postSlug;
}

/**
 * The key a slug-scoped collection caches under. Mirrors the `postSlug` part of
 * an explicit subset filter and otherwise falls back to the scope's slug, so
 * the key and the descriptor id cannot disagree about which post this is.
 */
export function slugScopedQueryKey(
  scope: DashboardCollectionScope,
  name: string,
  filters?: ReadonlyArray<CollectionEqFilter>,
  ...parts: ReadonlyArray<string | undefined>
): string[] {
  const slug = scopePostSlug(scope, filters);

  return slug
    ? organizationScopedQueryKey(scope, name, "postSlug", slug, ...parts)
    : organizationScopedQueryKey(scope, name, ...parts);
}

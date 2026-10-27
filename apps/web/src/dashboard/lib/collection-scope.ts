/**
 * Scope and identity rules for dashboard collections.
 *
 * Split out of `./collections` so the identity rules can be tested without the
 * RPC/schema module graph, and so the SSR follow-up has a single place to
 * change where a scope comes from. The key and slug rules themselves live in
 * `@feeblo/web-shared/collections`, shared with the public board; this module
 * only turns a pathname into a dashboard scope and a scope into descriptor ids.
 */
import { postSlugFromPath } from "@feeblo/web-shared/collections";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequestUrl } from "@tanstack/react-start/server";

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
 * The workspace a path starts with, when it starts with one.
 *
 * `WorkspaceId` ids are minted with the `org` prefix (`@feeblo/id`), so this is
 * what tells `/org_abc/settings` apart from `/register`, `/invitation/...`, and
 * the auth pages that share the dashboard's parent route. Rules that want to
 * act on the workspace before the route has matched (starting its preloads,
 * saying which scope a collection belongs to) read it from here rather than
 * re-deriving the prefix test.
 */
export function workspaceIdFromPathname(pathname: string): string | undefined {
  const [segment] = pathname.replace(/^\/+/, "").split("/");

  return segment?.startsWith("org_") ? segment : undefined;
}

/**
 * The request's pathname.
 *
 * Server rendering reads it from the request rather than `window`, which is
 * what lets a collection resolve its scope during SSR. The dashboard's
 * organization is the first path segment and the post slug sits in the path
 * too, so both branches parse the same string the same way.
 */
const currentPathname = createIsomorphicFn()
  .client(() => window.location.pathname)
  .server(() => getRequestUrl().pathname);

/**
 * The scope a dashboard pathname describes.
 *
 * One resolver for both halves: the organization is the `org_`-prefixed first
 * segment (so a public-board path served by the same app, `/s/<host>/…`, and
 * the auth pages above it resolve to *no* scope rather than to a bogus
 * organization), and the post slug comes from the dashboard's
 * `/:organizationId/…/post/:boardSlug/:postSlug` shape. Collections created
 * without an explicit filter capture it, so a descriptor belongs to the post it
 * was made for rather than to whichever post is on screen at fetch time.
 */
export function dashboardScopeFromPathname(
  pathname: string
): DashboardCollectionScope {
  return {
    organizationId: workspaceIdFromPathname(pathname),
    postSlug: postSlugFromPath(pathname, "post", 2),
  };
}

/** The scope of the page the browser (or the current request) is on. */
export function currentDashboardScope(): DashboardCollectionScope {
  return dashboardScopeFromPathname(currentPathname());
}

/**
 * A stable key for one scope, used to memoize a built collection set.
 *
 * Two scopes that produce the same descriptor ids produce the same key, which
 * is the property the memo needs and the one a `Map` on the scope object would
 * not have (the scope is rebuilt from the URL on every read).
 */
export function dashboardScopeKey(scope: DashboardCollectionScope): string {
  return `${scope.organizationId ?? ""}\u0000${scope.postSlug ?? ""}`;
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

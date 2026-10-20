/**
 * The routing facts a surface's collections read, and the `DbClient` keys they
 * are carried under.
 *
 * The dashboard and the public board both scope their collections to "the
 * organization this page belongs to" and "the post it is looking at", but they
 * learn those facts differently: the dashboard from the route it renders, the
 * board from the site it resolved and the slug in the URL. One interface,
 * injected through the client, lets both read the same two facts without either
 * collection module reaching for `window`.
 *
 * Kept free of TanStack imports on purpose: both apps already depend on
 * `@tanstack/react-db`, and this package does not need to.
 */
export interface CollectionContext {
  /**
   * The organization this page belongs to, or undefined before its layout has
   * resolved or published one.
   */
  getOrganizationId(): string | undefined;
  /**
   * Publishes the organization the current page belongs to.
   *
   * A surface whose layout resolves the organization out of band (the public
   * board) calls this before it preloads or materializes a collection. A
   * surface whose organization is its URL's first segment (the dashboard)
   * leaves it unset and resolves it at call time instead, because the URL
   * changes only when a navigation commits.
   */
  setOrganizationId(organizationId: string | undefined): void;
  /**
   * The post slug in the current URL, or undefined outside a post page.
   *
   * A function rather than a value because a browser client spans
   * navigations: the slug is resolved when a collection fetches, not when the
   * client was created.
   */
  getPostSlug(): string | undefined;
  /** The changelog slug in the current URL, or undefined outside an entry. */
  getChangelogSlug(): string | undefined;
  /**
   * Records that a server render did not get every preload it asked for, so
   * the document it produces is incomplete and must not be cached or indexed.
   */
  markPreloadDegraded(): void;
  isPreloadDegraded(): boolean;
}

/** `DbClient` dependency key holding the page's {@link CollectionContext}. */
export const COLLECTION_CONTEXT_DEPENDENCY = "collectionContext";

/** `DbClient` dependency key holding the request's TanStack Query client. */
export const COLLECTION_QUERY_CLIENT_DEPENDENCY = "queryClient";

/**
 * Creates a mutable context for one client.
 *
 * A surface either *resolves* the organization from the committed URL (the
 * dashboard: its route is the only thing that knows which organization the
 * page belongs to, and the URL changes only when the navigation commits) or
 * *publishes* it before materializing anything (the public board: its layout
 * resolves the site from the host). A published value wins, so the board can
 * set one on a client whose resolver would otherwise read a slug as an
 * organization.
 *
 * The slugs are functions, so a browser client resolves the slug of the page
 * it is on at query time rather than the one it was created on.
 *
 * `getChangelogSlug` is optional: the dashboard has no changelog-slug-scoped
 * collection, so its adapter omits it and the context reports undefined.
 */
export function createCollectionContext(options: {
  getOrganizationId?: () => string | undefined;
  organizationId?: string;
  getPostSlug: () => string | undefined;
  getChangelogSlug?: () => string | undefined;
}): CollectionContext {
  let published = options.organizationId;
  let preloadDegraded = false;

  return {
    getChangelogSlug: options.getChangelogSlug ?? (() => undefined),
    getOrganizationId: () => published ?? options.getOrganizationId?.(),
    getPostSlug: options.getPostSlug,
    isPreloadDegraded: () => preloadDegraded,
    markPreloadDegraded: () => {
      preloadDegraded = true;
    },
    setOrganizationId: (next) => {
      published = next;
    },
  };
}

# ADR 0024: A collection descriptor captures its scope

## Decision

A TanStack DB collection descriptor in either browser app is built from a scope it captures, and the two apps capture that scope in different shapes because their clients have different lifetimes:

- **`apps/public-feature-board`** carries a mutable `BoardScope` as a `DbClient` dependency (`BOARD_SCOPE_DEPENDENCY`). Descriptors are module-level constants; they read the scope through the client at query time. The host fills the scope from the site it resolved, and the browser fills it again on render.
- **`apps/web`**'s dashboard passes the scope as a **value**: `createDashboardCollections({ client, scope })` builds every descriptor for that one scope, and the module accessor (`dashboardCollections`) is a memoised per-client, per-scope set. `slugScopedCollectionId` / `organizationScopedCollectionId` put the scope in the descriptor id.

Both apps bind their query-key and slug rules through `createRpcCollectionHelpers` (`@feeblo/web-shared/collections`), so the rules are shared even though the plumbing is not.

## Why

The difference is the client's lifetime, not an inconsistency.

A board `DbClient` is built per request on the server and per document in the browser, and the site is resolved from the host during the layout, so the scope does not exist when the client is constructed. A mutable dependency is the only shape that fits: the client is created first, the layout publishes the organization id before any collection materializes, and slug lookups read the current location so one browser client stays correct across navigations.

The dashboard's browser client is a module singleton that outlives a navigation between workspaces. If the scope were a mutable dependency on that client, a descriptor's id could be computed before the scope settled and a workspace switch would reuse the previous workspace's collection — the cross-tenant bleed `fix(collections): key the dashboard's collections by their captured scope` closed. Capturing the scope at build time, and keying the descriptor id by it, is what makes "this collection belongs to this workspace, this post" a property of the descriptor rather than of when it happened to be read.

A single shared scope type would have to be mutable to serve the board, and the dashboard cannot afford mutable. Unifying them is a regression, not a simplification.

## Consequences

`apps/web`'s accessor keeps 33 lazy properties: a property read is what pins a collection to the current scope, so the set cannot be a frozen map built at module load. The getters resolve *which* set to read; every identity rule lives in `createDashboardCollections` and its deps.

`createDashboardCollections` is a pure function of `(client, scope)`, which is the test surface: `collections.test.ts` builds a `DbClient`, hands it a scope, and asserts every collection's id, that two scopes never share a collection, and that the same scope returns the same instances. Before this, no collection could be instantiated outside the app — the only test asserted that importing the module did not call `crypto.randomUUID`.

Index application is keyed per client, not per collection id alone. A collection id is unique within one `DbClient`, and each client (a test's, or one request's once the dashboard renders on the server) needs its own copy indexed; the earlier module-wide set left every client after the first without join indexes, invisibly.

The dashboard is still `ssr: false`. Making it render on the server needs two things this ADR does not settle: the scope must come from route context rather than `window.location`, and on-demand subsets must hydrate by query identity. Those are recorded in `docs/public-page-ssr.md`.

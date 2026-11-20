# apps/web

The TanStack Start app: the dashboard, the portal, the public board's server-rendered routes, and `/api/*`. Shared surface code lives in `packages/post-ui` and `packages/web-shared` rather than here.

This is client code. It imports no `@feeblo/db` and no server-only module, an `oxlint` boundary override enforces the first, and schemas and vocabulary come from `@feeblo/domain` instead. A type that crosses an RPC boundary is the response schema from the contract, never a repository row.

## Build

`src/paraglide/**`, `routeTree.gen.ts` and `worker-configuration.d.ts` are generated and uncommitted. Compile the messages with `pnpm --filter @feeblo/web build:paraglide` before typechecking this package by hand; `pnpm check` wires that dependency itself.

## Routes and state

- `src/routes` is the TanStack Router tree. A route file is a route, and a component that two routes share belongs in `src/dashboard`, `src/portal` or `packages/post-ui`.
- Collections and live queries come from `@feeblo/web-shared`, RPC calls from `@feeblo/rpc-client`, and `src/lib/atom-rpc.ts` is where an atom is bound to a contract. Do not hand-roll a fetch against `/rpc`.
- Anything rendered on the public board runs for anonymous visitors, so it reads through the public contract and never assumes a session.

## Copy and locale

Messages are Paraglide's, compiled from the shared root catalog, so a string added to a component belongs in `messages/*.json` and not inline. Read `docs/i18n/README.md` before touching the catalog, and the sibling page for a shared package (`docs/i18n/post-ui.md`, `docs/i18n/public-feature-board.md`) before changing how a package resolves its locale.

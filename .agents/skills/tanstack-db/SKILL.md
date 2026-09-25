---
name: tanstack-db
description: >
  Work with the TanStack DB reactive client-side data store in this repo:
  createCollection with queryCollectionOptions and other adapters, live queries
  via the query builder (from, where, join, select, groupBy, orderBy, limit),
  optimistic mutations with the draft proxy, transactions, persistence,
  preloading in route loaders, and React hooks from @tanstack/react-db.
  Entry point for the tanstack-db sub-skills.
type: core
library: db
library_version: '0.9.2'
---

# TanStack DB — Core Concepts

TanStack DB is a reactive client-side data store. It loads data into typed
collections from any backend (REST APIs, sync engines, local storage), provides
sub-millisecond live queries via differential dataflow, and supports instant
optimistic mutations with automatic rollback.

This repo is React + TanStack Start. Import everything from
`@tanstack/react-db`, which re-exports all of `@tanstack/db`. It uses
`@tanstack/query-db-collection` for RPC-backed collections.

## Source Of Truth

Use the current TanStack DB source, not memory or older examples.

1. If `~/.local/share/opencode/repos/github.com/TanStack/db` is missing, clone
   `https://github.com/TanStack/db` there. Do that, not in the skill folder.
2. Check the installed package versions before answering:
   `@tanstack/db` **0.9.2**, `@tanstack/react-db` **0.4.1**,
   `@tanstack/query-db-collection` **1.2.15**, `@tanstack/db-ivm` **0.1.22**.
   The package sources under `node_modules/@tanstack/*` are authoritative for
   the installed version; the clone is for docs, examples, and tests.
3. Search `node_modules/@tanstack/*/skills` and the cloned repo for exact APIs,
   examples, tests, and naming patterns before writing TanStack DB code.
4. Inspect existing repo code first and follow its patterns. The two collection
   factories are `apps/web/src/dashboard/lib/collections.ts` and
   `apps/public-feature-board/src/lib/collections.ts`.

## Sub-Skills

| Need to...                                       | Read                        |
| ------------------------------------------------ | --------------------------- |
| Create a collection, pick an adapter, add schema | collection-setup/SKILL.md   |
| Query data with where, join, groupBy, select     | live-queries/SKILL.md       |
| Insert, update, delete with optimistic UI        | mutations-optimistic/SKILL.md |
| Build a custom sync adapter                      | custom-adapter/SKILL.md     |
| Persist collections to SQLite (offline cache)    | persistence/SKILL.md        |
| Preload collections in route loaders             | meta-framework/SKILL.md     |
| Use React hooks (useLiveQuery, Suspense, paced)  | react-db/SKILL.md           |

Other framework skills (`vue-db`, `svelte-db`, `solid-db`, `angular-db`) and
`offline` (from `@tanstack/offline-transactions`) ship in their own packages;
none of them are installed in this repo.

## Quick Decision Tree

- Setting up for the first time? → collection-setup
- Building queries on collection data? → live-queries
- Writing data / handling optimistic state? → mutations-optimistic
- Using React hooks? → react-db
- Preloading in route loaders (TanStack Start)? → meta-framework
- Building an adapter for a new backend? → custom-adapter
- Persisting collections to SQLite? → persistence

## Repo Rules

- **`useLiveQuery` takes the config object** — `useLiveQuery({ query: (q) => ... })`.
  Never pass a legacy dependency array; the repo was migrated off it. Query
  identity is derived from the structured query IR, so captured values re-run
  the query automatically. Use `queryKey` only for opaque `.fn.*` queries.
- **Always prefer query operators over JS** — `eq`, `inArray`, `like`, etc. are
  incrementally maintained; `.filter()` in JS re-runs from scratch.
- **The update API is Immer-style** — `collection.update(id, (draft) => { ... })`.
- **Every collection has an explicit `id`** — Workers forbid random values in
  global scope, and the SSR bundle imports these modules at startup.
- **Index join and filter fields** — joins warn in dev when the loaded side has
  no index. Follow the existing `createIndex(..., { indexType: BasicIndex })`
  style in both collection files.
- **SSR is not supported for collections** — routes using collections set
  `ssr: false`; preload in client-side route loaders.

## Version

Targets `@tanstack/db` v0.9.2.

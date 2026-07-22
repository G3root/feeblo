---
name: tanstack-db
description: Work with TanStack DB reactive client-side data store in this repo
---

# TanStack DB

This codebase uses TanStack DB for reactive client-side data stores with normalized collections, live queries, and optimistic mutations.

## Source Of Truth

Use the current TanStack DB source, not memory or older examples.

1. If `~/.local/share/opencode/repos/github.com/TanStack/db` is missing, clone `https://github.com/TanStack/db` there. Do there, not in the skill folder.
2. Search `~/.local/share/opencode/repos/github.com/TanStack/db` for exact APIs, examples, tests, and naming patterns before answering or implementing TanStack DB-specific code.
3. Also inspect existing repo code for local house style before introducing new patterns.
4. Prefer answers and implementations backed by specific source files or nearby repo examples.

## Core Concepts

TanStack DB is a reactive client-side data store providing normalized collections, sub-millisecond live queries via differential dataflow (d2ts), and instant optimistic mutations with automatic rollback. It supports multiple data sources through a unified collection API with framework adapters for React, Vue, Svelte, Solid, and Angular.

## Key Domains

| Domain                       | Description                                                                                                                | Skills                |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| Collection Setup & Schema    | Creating and configuring typed collections from any data source, with schema validation and adapter-specific sync patterns | collection-setup      |
| Live Query Construction      | Building SQL-like reactive queries with expressions, joins, aggregations, and incremental view maintenance                 | live-queries          |
| Framework Integration        | Binding live queries to UI framework components using hooks, dependency tracking, Suspense, and pagination                 | framework-integration |
| Mutations & Optimistic State | Writing data with instant optimistic feedback, transaction lifecycles, and automatic rollback                              | mutations-optimistic  |
| Meta-Framework Integration   | Client-side preloading of collections in route loaders for TanStack Start, Next.js, Remix, etc.                            | meta-framework        |
| Custom Adapter Authoring     | Building custom collection adapters that implement the SyncConfig contract                                                 | custom-adapter        |
| Offline Transactions         | Offline-first transaction queueing with persistence, retry, and multi-tab coordination                                     | offline               |

## Guidelines

- Prefer current TanStack DB APIs and project-local patterns over old blog posts, examples, or package-memory guesses.
- **Always prefer query operators over JS** — Live queries are incrementally maintained via D2 differential dataflow. A `.where(eq(...))` only recomputes the delta on data changes, while `.filter()` in JS re-runs from scratch. This applies even for trivial transformations.
- **The update API is Immer-style** — `collection.update(id, (draft) => { draft.title = "new" })` not `collection.update(id, { ...item, title: "new" })`. This is the single most common mutation API mistake.
- **Collection type selection matters** — Don't default to bare `createCollection` or `localOnlyCollectionOptions`. Each backend has a dedicated adapter that handles sync, handlers, and utilities correctly.
- `localOnlyCollectionOptions` is a valid prototyping strategy — upgrading to a real backend adapter is a clean path.
- **SSR is not supported yet** — Collections are client-side only. Routes using collections must set `ssr: false`. Preloading happens in client-side route loaders, not on the server.
- **Transactions stack** — Concurrent transactions build optimistic state on top of each other. Use TanStack Pacer for sequential execution when ordering matters.
- **Offline is hard — only when needed** — Don't steer users toward offline unless they need it. PowerSync/RxDB handle their own local persistence, which is different from offline transaction queuing.
- Use `StandardSchema` for schema validation (Zod, Valibot, ArkType, Effect Schema).
- Keep HTTP handlers thin: decode input, read request context, call services, and map transport errors. Put business rules in services.

## Common Failure Modes

### Collection Setup & Schema
- `queryFn` returning empty array deletes all data — always merge or return existing data.
- `getKey` returning undefined — must return a stable string ID.
- `TInput` not superset of `TOutput` with schema transforms — schema output must be assignable.
- Providing both explicit type param and schema — pick one.
- React Native missing `crypto.randomUUID` — polyfill required.
- Direct writes overridden by next query sync — use `queryFn` that merges, or use `onSync` to preserve local writes.

### Live Query Construction
- Using `===` instead of `eq()` in where clauses — use query operators, not JS.
- Filtering/transforming data in JS instead of query operators — breaks incremental maintenance.
- `.distinct()` without `.select()` — must select first.
- `.having()` without `.groupBy()` — not valid.
- `.limit()`/`.offset()` without `.orderBy()` — results are non-deterministic.
- Join condition using operator other than `eq()` — only equality joins supported.
- Passing source directly instead of `{alias: collection}` — use aliased form for joins.

### Mutations & Optimistic State
- Passing object to `update()` instead of mutating draft — use Immer-style draft callback.
- `onMutate` callback returning a Promise — must be synchronous.
- `insert`/`update`/`delete` without handler or ambient transaction — handlers must be configured.
- `.mutate()` after transaction no longer pending — transaction context is lost.
- Attempting to change primary key via `update` — primary keys are immutable.
- Inserting item with duplicate key — use `upsert` or generate unique IDs.
- Not awaiting refetch after mutation in query collection handler — causes stale data.

### Framework Integration
- Missing external values in `deps` array — query won't re-run on external changes.
- Reading Solid signals outside query function — must read inside the query function.
- `useLiveSuspenseQuery` without Error Boundary — will crash.
- Svelte props not wrapped in getter functions — use `() => prop`.

### Meta-Framework Integration
- Not preloading collections in route loaders — causes loading waterfall.
- Not setting `ssr: false` on routes using collections — SSR will fail.
- Creating new collection instances inside loaders on every navigation — reuse instances.

### Custom Adapter Authoring
- Not calling `markReady()` in sync implementation — collection never becomes ready.
- Race condition: subscribing after initial fetch — subscribe before fetching.
- `write()` called without `begin()` — transaction must be started first.

### Offline Transactions
- Using offline transactions when not needed — adds unnecessary complexity.
- Not handling `NonRetriableError` for permanent failures — will retry forever.
- Multiple tabs executing same queued transaction — use leader election.

## Testing Patterns

- Use the repo's existing test helpers and live tests for collections, queries, and mutations.
- For framework integration tests, use the framework-specific test utilities (React Testing Library, Vue Test Utils, etc.).
- Test optimistic mutations by verifying draft state before the async operation completes.
- Test live queries by mutating data and verifying the query result updates reactively.
- Test custom adapters by verifying the `SyncConfig` contract is fulfilled: `begin`/`write`/`commit`/`markReady`/`loadSubset`.

## Package Reference

| Package                         | Purpose                                      |
| ------------------------------- | -------------------------------------------- |
| `@tanstack/db`                  | Core: collections, live queries, transactions |
| `@tanstack/react-db`            | React hooks (`useLiveQuery`, `useLiveSuspenseQuery`) |
| `@tanstack/vue-db`              | Vue composables                              |
| `@tanstack/svelte-db`           | Svelte stores                                |
| `@tanstack/solid-db`            | SolidJS signals                              |
| `@tanstack/angular-db`          | Angular services                             |
| `@tanstack/offline-transactions`| Offline transaction queueing                 |
| `@tanstack/db-collection-e2e`   | End-to-end test utilities                    |
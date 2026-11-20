# @feeblo/domain

Domain behaviour: Effect Schema definitions, repositories over Drizzle, RPC contracts and handler layers. Reads Postgres through `@feeblo/db`, imports nothing from `apps/`, and takes `@feeblo/integration-core` as its only integration dependency; the provider packages are supplied by `apps/server`.

## A module

One directory per entity under `src/<entity>/`, following the shape of a neighbour rather than inventing one:

- `schema.ts` — Effect Schema
- `errors.ts` — tagged errors
- `repository.ts` — Drizzle access
- `rpcs.ts` — the RPC contract
- `handlers.ts` — the layers
- `policies.ts` — where authorization applies

## A Public API surface

A feature with a `/api/v1` surface owns it in `<entity>/public-api/`: `schema.ts` (closed DTOs and HTTP shapes), `operations.ts` (the surface-neutral capability a future MCP tool binds), `http.ts` (the `HttpApiEndpoint`s and handlers), `mappers.ts`, and a `repository.ts` only where the public projection genuinely differs from the feature repository. Tag and company operations call `<entity>/repository.ts` directly.

The shared infrastructure — the operation helper, registry, key middleware, error vocabulary and composition root — stays in `src/public-api/`.

Public DTOs are hand-written, and they import neither a dashboard or portal response schema, which carry internal actor identifiers, nor the session middleware, because a machine key must not resolve into a member session. `oxlint.config.ts` enforces both halves and carries the reason above each override.

## RPC registration

One registry in two halves, split because the browser reads one half:

- `src/rpc-group.ts` lists every `*Rpcs` group in `RpcGroups` and derives `AllRpcs` from it. It imports no handler layer, so the dashboard and public board bundle the contract without repositories or the database.
- `src/rpc-router.ts` pairs every group name with its handler layer in `RpcHandlerRegistrations`, marking the four provider-owned management groups as `"provider"`. Its `satisfies Record<RpcGroupName, …>` makes a group with no entry a compile error.

Adding a group is a line in each, plus an entry in the provider map in `apps/server` when a provider owns it. `rpc-router.test.ts` pins the registry at runtime, so the two lists cannot drift apart.

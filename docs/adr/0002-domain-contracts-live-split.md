# ADR 0002: Split `@feeblo/domain` into contracts and live implementations

## Decision

`@feeblo/domain` is split along its contract/implementation seam:

- **`@feeblo/domain-contracts`** — Effect Schema types, canonical vocabularies, RPC interfaces, and policy/error definitions. Depends only on `effect`. Safe for every workspace, including browser bundles and provider packages.
- **`@feeblo/domain`** (live) — repositories, services, workflows, and RPC handlers. Keeps its database, transactional-email, and provider dependencies.
- Provider-specific orchestration currently under `domain/src/integration/{slack,discord,github}` moves into the corresponding `integrations/*` packages over time; `domain` must stop depending on provider packages, not the reverse.

Migration is incremental (strangler pattern): a module moves when work touches it, and `@feeblo/db` keeps re-export shims for moved vocabularies so existing server-side imports keep working.

## Why

`domain` became a universal hub: every workspace depends on it, and it depends on every integration package. Client packages that need only a type pull the whole server graph into their build; any provider change invalidates every downstream cache; the graph trends toward cycles. A dependency-light contracts package gives frontends, widgets, and providers a stable target and restores acyclicity:

```
apps/web ─┐
widget ───┼─> domain-contracts <─┐
sdk ──────┘                      │
integrations/* ──────────────────┤
domain (live) ───────────────────┴─> db, transactional
```

## Consequences

Phase 1 (this ADR): the canonical vocabularies move from `packages/db/src/validation-schema/*` (pure Effect Schema with no database dependency) into `@feeblo/domain-contracts`; `db` re-exports them unchanged. Client packages import the vocabulary directly from `domain-contracts`, making the lint-enforced "no `@feeblo/db` in client code" boundary structural rather than convention.

Later phases: per-entity `schema.ts`/`rpcs.ts` files migrate as they are touched; integration orchestration migrates behind interfaces defined in `domain-contracts/integration`. Until a phase completes, both import paths may coexist; new client-facing imports must target `domain-contracts`.

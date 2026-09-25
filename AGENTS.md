# Agent instructions

Repo law. It holds the commands, the gate, and the changes that need a human decision.

Two other documents are authoritative for their own subject and are not duplicated here: `CONTEXT.md` fixes the product's vocabulary (Post, Connection, Capability, Route, Delivery, Public API, API key, Scope), and `docs/adr/` records why specific boundaries exist. This file is the source of truth for _how to change things_.

## Stack contract

Dependencies are declared in the `catalog` block of `pnpm-workspace.yaml` and referenced as `catalog:`. Prefer that over writing a version in a package.

- pnpm workspaces + Turborepo. Node `26.4.0` (`.node-version`), pnpm `11.0.3` (`packageManager`). Do not introduce a second package manager.
- Effect `4.0.0-rc.112`, `@effect/platform-node` `4.0.0-rc.112`, `@effect/vitest` `4.0.0-rc.112`. These three are one release train; bump them together.
- TypeScript `7.0.2`, Oxlint `1.82.0`, `oxlint-tsgolint` `7.0.2001`, `@effect/tsgo` `0.45.0`. These four are also one release train: `effect-tsgo patch` (run from `prepare` on every install) names the versions it supports and refuses to patch a mismatch. A bump is a four-line change or it is wrong.
- Drizzle `1.0.0-rc.5-169397b`, better-auth `1.7.2`, React `19`, TanStack Start for `apps/web`.

`prepare` runs `effect-tsgo patch --typescript --oxlint`. That single command is what makes the Effect language service load in `tsc` and registers the `effecttsgo` Oxlint plugin; without it, Effect diagnostics silently disappear.

## Packages

| Package | Path | Role |
| --- | --- | --- |
| `@feeblo/domain` | `packages/domain` | Domain behavior. Owns schemas, repositories, RPC contracts, handlers. Reads Postgres through `@feeblo/db`. |
| `@feeblo/domain-contracts` | `packages/domain-contracts` | Effect Schema vocabularies and policy/error definitions that both browser and server may import. Depends only on `effect`; see `docs/adr/0002`. |
| `@feeblo/db` | `packages/db` | Drizzle schema, migrations, PGlite test database, seed/nuke scripts. |
| `@feeblo/db-migrator` | `packages/db-migrator` | Standalone migration runner for deployments. |
| `@feeblo/auth` | `packages/auth` | better-auth wiring, the organization ACL, API-key plugin, session/API-key seams. |
| `@feeblo/permissions` | `packages/permissions` | Member permission catalog, shared with the frontend. |
| `@feeblo/id` | `packages/id` | Branded identifier types (`Legid`). |
| `@feeblo/utils` | `packages/utils` | Shared primitives, including the `runtime-kind` guards (`isString`, `isPlainObject`, …) that replace bare `typeof`. |
| `@feeblo/config` | `packages/config` | `tsconfig.base.json` and small Effect `Config` helpers. |
| `@feeblo/rpc-client` | `packages/rpc-client` | Effect RPC client used by the dashboard and portal. |
| `@feeblo/web-shared` | `packages/web-shared` | Shared browser code: collections helpers, auth context, RPC error parsing. |
| `@feeblo/ui` | `packages/ui` | Shared React components. |
| `@feeblo/post-ui` | `packages/post-ui` | The post/comment/roadmap surface, shared by the dashboard and the portal. |
| `@feeblo/public-feature-board` | `apps/public-feature-board` | The public, session-less board app. |
| `@feeblo/feedback-widget` | `packages/feedback-widget` | The Solid iframe bundle for embedding. |
| `@feeblo/sdk`, `@feeblo/sdk-react` | `packages/sdk*` | Published client SDKs. `publishConfig.access: public`. |
| `@feeblo/server` | `apps/server` | HTTP composition root: RPC route, Public API, integration providers. |
| `@feeblo/web` | `apps/web` | TanStack Start dashboard and portal. |
| `@feeblo/integration-core` | `integrations/core` | Provider registry, delivery worker, credential encryption, event recording. |
| `@feeblo/integration-{webhook,slack,discord,github}` | `integrations/*` | One provider each. |
| `@feeblo/transactional` | `packages/transactional` | Email templates and mailer. |
| `@feeblo/e2e` | `e2e` | Playwright. Not part of `pnpm test`. |

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm check` | **The gate.** `turbo run check` = every package's `tsc --noEmit`, then type-aware Oxlint plus the formatter check. |
| `pnpm typecheck` | Types only. Cached per package. |
| `pnpm lint` | `oxlint && oxfmt --check .` |
| `pnpm lint:fix` | The writer: `oxlint --fix && oxfmt`. |
| `pnpm fmt` / `pnpm fmt:check` | Formatting only. |
| `pnpm test` | Unit tests, `@feeblo/e2e` excluded. |
| `pnpm test:e2e` | Playwright. Needs built apps; see `e2e/package.json`. |
| `pnpm dev:server` / `dev:web` / `dev:native` | Dev servers. `pnpm dev` runs everything. |
| `pnpm db:*` | `push`, `generate`, `migrate`, `seed`, `studio`, `start`, `stop`, `nuke`. |
| `pnpm build` | `turbo build`. |

`apps/web` needs generated Paraglide output before it typechecks, so the `typecheck` turbo task depends on `build:paraglide`. `pnpm check` handles this on its own; a bare `tsc` in `apps/web` will not.

Run `pnpm check` before claiming a change is ready. It needs no database, no build output, and no environment file.

## The fence

What actually enforces the rules:

- CI (`checks` job) runs `pnpm check` on every push and pull request.
- CI also runs `build_app` (Playwright against built apps), `test` (unit), and `docker_smoke_test` (self-hosted compose stack).
- `autofix.yml` runs `pnpm fmt` and `pnpm lint:fix` and commits the result. It is a writer, not a gate: a violation it cannot fix does not fail it.
- `tools/oxlint/effect-tests` reports `Effect.run*` and `ManagedRuntime.make` in test files as an **error**, so hand-running an Effect fails the gate.

**There is no commit hook.** Nothing stops a commit that fails the gate; CI catches it about twenty minutes later. Never pass `--no-verify` to git, and do not add a commit hook without deciding how it is protected from bypass.

If a check fails, fix the failure. Do not loosen the rule to get green. If a rule is genuinely wrong for this codebase, turn it off in `oxlint.config.ts` with a written reason directly above it — the `effecttsgo/*` and `typescript/*` overrides in that file are the pattern to copy. A rule turned off without a reason is indistinguishable from a rule nobody could be bothered to satisfy.

## Effect code

Effect diagnostics live in Oxlint (`effecttsgo/*`), not in `tsc`. `packages/config/tsconfig.base.json` sets `diagnostics: false` on the language service so a finding is reported once, by the tool that can act on it. Put severity changes in `oxlint.config.ts`.

Four `effecttsgo/*` rules are `off` with reasons in that file: `async-function`, `global-date`, `process-env`, and `global-console`. Each names the code that legitimately does the thing outside Effect. Their `-in-effect` siblings are on, and those are the ones that describe a defect — `new Date()` inside Effect bypasses `Clock`, which is why services that do it cannot be tested against `TestClock`. `typescript/no-unnecessary-type-arguments` is off for the same kind of reason: 131 findings that are all the same non-defect.

`docs/adr/0005` records the ratchet order for what is still a warning.

Before writing, reviewing, or refactoring Effect code, read the installed package's own guide first: `node_modules/effect/AGENTS.md`. It ships with the version in the lockfile, so it is never stale, and it is a better reference than anything written down here.

Tests use `@effect/vitest`:

- `it.effect` and `it.layer` — never `Effect.runPromise`, `Effect.runSync`, or `ManagedRuntime.make` inside a test file.
- The reason is not style: `it.effect` gives each test a `Scope`, the `TestClock`, and layer memoization, and it fails the test when the Effect fails.
- One documented exception, `packages/auth/src/api-key.test.ts`, which shares one PGlite database across the file and hands it to the better-auth adapter as a plain value. Its `oxlint-disable` carries the reason inline.

Match errors by tag, not by prototype: `Schema.is(SomeError)(error)` or `Predicate.isTagged(error, "SomeError")`. A decoded error is a plain object carrying `_tag` with no prototype, so `instanceof` answers `false` for a real one and the branch silently takes its fallback. Read randomness, time, and environment through Effect services (`Crypto`, `Clock`, `Config`), not the globals; `packages/domain/src/jwt-secret/repository.ts` is a good example.

## Architecture

Dependency direction: apps → `packages/domain` → `{db, id, permissions, utils, domain-contracts}`. **Packages never import apps** — that holds today and should keep holding. Client-side packages (`apps/web`, `apps/public-feature-board`, `post-ui`, `web-shared`, `ui`, `feedback-widget`, `sdk`) must not import `@feeblo/db` at all; an `oxlint` boundary override enforces it. Import schemas and vocabulary from `@feeblo/domain` instead.

A domain module is `packages/domain/src/<entity>/` with a consistent shape: `schema.ts` (Effect Schema), `errors.ts` (tagged errors), `repository.ts` (Drizzle access), `rpcs.ts` (the RPC contract), `handlers.ts` (the layers), and `policies.ts` where authorization applies. Follow the shape of a neighbouring module rather than inventing one.

Two files are hand-maintained lists that must stay in sync, and today nothing checks them:

- `packages/domain/src/rpc-group.ts` composes every `*Rpcs` group into `AllRpcs`.
- `packages/domain/src/rpc-router.ts` provides every `*RpcHandlers` layer.

Adding an RPC means editing both. `rpc-group.ts` currently lists 34 groups and `rpc-router.ts` 30, the difference being the four provider-owned management groups that `apps/server` supplies (see `docs/adr/0002`) plus the `Core` merge. A group with no handler layer compiles cleanly and fails at runtime.

The four surfaces, deliberately not sharing one contract:

1. **Dashboard RPC** — session-authenticated Effect RPC over `/rpc`.
2. **Public API** — versioned, API-key-authenticated `/api/v1`. Its DTOs are hand-written in `packages/domain/src/public-api/schema.ts` and must never import dashboard or portal response schemas, which carry internal actor identifiers. `docs/adr/0004` and an `oxlint` override both enforce this.
3. **SDKs** — `packages/sdk`, `packages/sdk-react`. Published, so treat the public shape as a contract.
4. **Integrations** — provider registry plus the durable delivery worker. `packages/domain` does not depend on provider packages; `apps/server` is the composition root that supplies their handler layers.

`apps/server` is the only place layers are assembled. If an Effect error or a requirement channel looks wrong at a boundary, the fix usually belongs there.

## Boundaries and sign-off

**Safe by default** — make these changes and record them in the PR:

- Tests: new cases, tightened assertions, converting a test to `it.effect`.
- A lint rule loosened _or tightened_ in `oxlint.config.ts`, with the reason written beside it.
- Documentation: `README.md`, `CONTEXT.md`, `docs/`, a new ADR for a decision that has already been made.
- New code inside an existing module, following that module's shape.
- A targeted `oxlint-disable-next-line` with a written reason.

**Needs owner sign-off before you write it** — ask, then do it in its own commit:

- Any dependency addition or version change, including devDependencies. The catalog and the four-version tsgo train both make this a real decision.
- Anything that loosens the fence: a rule moved to `off`, a compiler option relaxed in `packages/config/tsconfig.base.json`, a task removed from `check` in `turbo.json`, or a new `.github/workflows/` change.
- The authorization and credential surface: `packages/auth`, `packages/domain/src/session-middleware.ts`, `packages/domain/src/auth-handler.ts`, `packages/domain/src/public-api/`, `packages/domain/src/api-key/`.
- Money and limits: `packages/domain/src/billing/`, `packages/domain/src/plan-entitlements.ts`, `packages/domain/src/rate-limit.ts`.
- Database migrations (`packages/db/src/migrations/`). They are irreversible in production.
- Removing or widening the `eslint/no-restricted-imports` boundary overrides.
- Publishing: anything that changes the public shape of `@feeblo/sdk` or `@feeblo/sdk-react`, or the `publish-sdks` workflow.
- Adding a workspace package, or changing `.env.example` in a way that alters an existing variable's meaning.

If a task seems to require one of these, do the rest and surface the decision instead of making it quietly.

## Source control

- Inspect `git status` before editing. This repository is often worked in concurrently, so a dirty tree may not be yours.
- Stage only the files changed for the current task. Do not sweep unrelated edits into a commit.
- Do not commit generated output: `src/paraglide/**`, `worker-configuration.d.ts`, `routeTree.gen.ts`, `*.tsbuildinfo`, `playwright-report/`, `test-results/`.
- Write commit messages that say what was wrong and why the change fixes it. A commit that only names the file is not a reviewable commit.
- Use the existing branch and remote. Do not initialise a new repository or migrate the remote without approval. Never pass `--no-verify`.

## When something looks broken

- **Effect diagnostics went quiet.** Check that `prepare` ran and patched both tools: `pnpm exec effect-tsgo patch --typescript --oxlint --force`. If `pnpm install` reported `skipped because its hash matches the replacement`, the pnpm store is serving a previously patched binary; `unpatch` then `patch --force` fixes it. This does not happen on a fresh CI runner.
- **`tsc --noEmit` fails in `apps/web` on a missing `@/paraglide/*`.** Run `pnpm --filter @feeblo/web build:paraglide`, or use `pnpm check`.
- **A run of `pnpm test` is slow.** The `test` turbo task is `cache: false`, so nothing about a test run is reused. Filter to the package you are working in.

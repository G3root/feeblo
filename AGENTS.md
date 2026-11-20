# Agent instructions

Feeblo is a customer-feedback product: a TanStack Start dashboard and portal (`apps/web`), a session-less public board (`apps/public-feature-board`), an Effect HTTP composition root (`apps/server`), an embeddable widget, and outbound integrations. Effect v4 throughout.

`CONTEXT.md` fixes the product vocabulary (Post, Connection, Capability, Route, Delivery, Public API, API key, Scope). `docs/` holds the topic guides. Each package's own `AGENTS.md` holds its local law. **This file is the source of truth for how to change things.**

## Commands

```sh
pnpm check        # the gate: toolchain guard, every tsrs --noEmit, type-aware lint + format check, knip
pnpm typecheck    # types only, cached per package
pnpm lint         # effect-tsgo --tsrs-lint oxlint && oxfmt --check .
pnpm lint:fix     # the writer: oxlint --fix && oxfmt
pnpm test         # unit tests, @feeblo/e2e excluded, cache off
pnpm test:e2e     # Playwright, needs built apps
pnpm dev:web      # dashboard + public board
pnpm dev:server   # HTTP server
pnpm db:generate  # migration from a schema change; also db:migrate, db:seed, db:studio, db:start, db:stop, db:nuke
```

`pnpm check` needs no database, no build output and no environment file. `apps/web` typechecks only once `build:paraglide` has run; the gate wires that dependency itself, a bare `tsrs --noEmit` there does not.

## The gate

Run `pnpm check` before claiming a change is ready. CI runs it on every push and pull request, beside `e2e`, `test` and a self-hosted compose smoke test.

There is **no commit hook**, so nothing stops a commit that fails the gate; CI catches it about twenty minutes later. Never pass `--no-verify`.

When a check fails, fix the failure. A rule that is genuinely wrong for this codebase is turned `off` in `oxlint.config.ts` with a written reason directly above it, beside the `effecttsgo/*` and `typescript/*` overrides that are the pattern to copy. The reasoning for every rule and every pin already lives in that file and in `check-toolchain.ts`; read it there rather than trusting a document that can drift.

`autofix.yml` runs `pnpm fmt` and `pnpm lint:fix` and commits the result. It is a writer, not a gate: a violation it cannot fix does not fail it.

## Effect code

Read `node_modules/effect/AGENTS.md` before writing, reviewing or refactoring Effect code. It ships with the version in the lockfile, so it is never stale.

- **Shapes.** `Effect.gen` inline, `Effect.fn("name")` when a span is useful, `Effect.fnUntraced` when it is not. No function that only wraps and returns an `Effect.gen`; attach behaviour with combinators.
- **Errors.** `return yield* new SomeError({...})` over `Schema.TaggedError`, kept in the typed channel. Match by tag with `Schema.is(SomeError)(error)` or `Predicate.isTagged(error, "SomeError")`. A decoded error is a plain object carrying `_tag` with no prototype, so `instanceof` answers `false` for a real one and the branch silently takes its fallback.
- **Environment.** Read randomness, time and environment through `Crypto`, `Clock` and `Config`, never the globals. `packages/domain/src/jwt-secret/repository.ts` is the shape to copy.
- **Diagnostics.** Effect findings live in Oxlint (`effecttsgo/*`), not in the compiler; `packages/config/tsconfig.base.json` sets `diagnostics: false` so each is reported once, by the tool that can act on it. Run the linter through `pnpm lint`, since a bare `oxlint` has no `effecttsgo/*` rules by design.
- **Tests.** `it.effect` and `it.layer` from `@effect/vitest`, never `Effect.runPromise`, `Effect.runSync` or `ManagedRuntime.make`. `it.effect` gives each test a `Scope`, the `TestClock` and layer memoization, and fails the test when the Effect fails; `tools/oxlint/effect-tests` reports violations as an error. The one exception is `packages/auth/src/api-key.test.ts`, which shares one PGlite database across the file, and its `oxlint-disable` carries the reason inline.

## Boundaries

- **Direction.** `apps` → `packages/domain` → `{db, id, permissions, utils, domain-contracts}`. Packages never import apps.
- **Contracts.** `domain-contracts` holds the Effect Schema vocabularies and policy/error definitions that both browser and server import, and depends on `effect` alone.
- **Client code.** `apps/web`, `apps/public-feature-board`, `post-ui`, `web-shared`, `ui`, `feedback-widget`, `sdk` and `sdk-react` never import `@feeblo/db`; an `oxlint` override enforces it. Import schemas and vocabulary from `@feeblo/domain` instead.
- **Browser code.** Shared UI splits three ways: `ui` is presentational components (they depend on `web-shared`, never the reverse), `web-shared` is collections, auth context and RPC plumbing, and `post-ui` is the post, comment and roadmap surface the dashboard and portal both mount.
- **Surfaces.** Dashboard RPC, Public API (`/api/v1`, API key), the published SDKs and the integration providers are four contracts that deliberately do not share one shape. See `apps/server/AGENTS.md`.
- **Generated output** stays uncommitted: `src/paraglide/**`, `worker-configuration.d.ts`, `routeTree.gen.ts`, `*.tsbuildinfo`, `playwright-report/`, `test-results/`.

## Needs owner sign-off

Ask before writing any of these, and land each in its own commit.

- Any dependency addition or version change, including devDependencies. The catalog and the compiler train both make this a real decision.
- Anything that loosens enforcement: a rule moved to `off`, a compiler option relaxed in `packages/config/tsconfig.base.json`, a task removed from `check` in `turbo.json`, or a new `.github/workflows/` change.
- The authorization and credential surface: `packages/auth`, `packages/domain/src/session-middleware.ts`, `packages/domain/src/auth-handler.ts`, `packages/domain/src/public-api/`, `packages/domain/src/api-key/`.
- Money and limits: `packages/domain/src/billing/`, `packages/domain/src/plan-entitlements.ts`, `packages/domain/src/rate-limit.ts`.
- Database migrations in `packages/db/src/migrations/`. They are irreversible in production.
- Removing or widening an `eslint/no-restricted-imports` boundary override.
- Publishing: any change to the public shape of `@feeblo/sdk` or `@feeblo/sdk-react`, or to the `publish-sdks` workflow.
- Adding a workspace package, or changing `.env.example` in a way that alters an existing variable's meaning.

If a task seems to require one of these, do the rest and surface the decision instead of making it quietly.

## Safe by default

Tests, a lint rule loosened _or_ tightened with its reason beside it, documentation, new code inside an existing module following that module's shape, and a targeted `oxlint-disable-next-line` with a written reason. Record these in the PR.

## Source control

Inspect `git status` before editing, because this repository is often worked in concurrently and a dirty tree may not be yours. Stage only the files changed for the current task, never sweeping unrelated edits into a commit. Write a message that says what was wrong and why the change fixes it; a commit that only names the file is not reviewable. Use the existing branch and remote.

## Where to read next

| Touching | Read |
| --- | --- |
| `packages/domain`, RPC groups, handlers | `packages/domain/AGENTS.md` |
| Drizzle schema, transactions, migrations | `packages/db/AGENTS.md` |
| Sessions, API keys, org ACL, SSO | `packages/auth/AGENTS.md` |
| Layer composition, provider wiring | `apps/server/AGENTS.md` |
| Routes, dashboard, portal, i18n | `apps/web/AGENTS.md`, `docs/i18n/README.md` |
| `/api/v1`, API keys, SDK-facing DTOs | `docs/public-api.md` |
| Webhooks, Slack, Discord, GitHub | `docs/integrations.md`, `docs/webhooks.md` |
| Permissions and member roles | `docs/permissions.md` |
| Notifications, audit log, on-behalf | `docs/notifications.md`, `docs/audit-log.md`, `docs/on-behalf.md` |
| Tracing, metrics, error reporting | `docs/telemetry.md` |
| Dependency and compiler bumps | `docs/toolchain.md` |
| `oxlint.config.ts`, `knip.config.ts` | the reason written above the entry you want changed |
| Self-hosting, releases, R2 | `docs/self-hosting.md`, `docs/sdk-releases.md`, `docs/r2-production-checklist.md` |
| Any Effect API question | `node_modules/effect/AGENTS.md` |

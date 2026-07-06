# Feeblo

Open-source customer feedback platform — collect feature requests, roadmaps, changelogs, and an embeddable feedback widget. Built as a pnpm + Turborepo monorepo using [Effect](https://effect.website), [Drizzle](https://orm.drizzle.team), and [Astro](https://astro.build).

Licensed under the [GNU AGPL-3.0](./LICENSE).

## Monorepo layout

```
apps/
  server/              Effect-based HTTP API (rolldown build, tsx dev)
  web/                 Astro dashboard (React + Solid islands, Cloudflare deploy)
  public-feature-board/  Public feature board UI package (TanStack Router/DB)
packages/
  auth/                better-auth integration
  db/                  Drizzle schemas + migrations (PostgreSQL)
  db-migrator/         Migration runner
  domain/              Core domain: users, workspaces, boards, posts, comments,
                       upvotes, reactions, changelogs, tags, billing, S3, RPC router
  editor/              Rich text editor
  feedback-widget/     SolidJS embeddable widget
  post-ui/             Post rendering components
  id/                  ID generation
  rpc-client/          Typed RPC client
  sdk/                 Embeddable feedback widget SDK (UMD + ESM)
  transactional/       Transactional email templates
  ui/                  Shared UI primitives (shadcn-style)
  utils/               Shared utilities
  web-shared/          Shared web code
```

## Tech stack

- **Runtime/Server:** Node 26+, Effect v4, `@effect/platform-node`, `@effect/sql-pg`
- **Database:** PostgreSQL via Drizzle ORM (`drizzle-kit` for migrations)
- **Auth:** better-auth (with Polar billing integration)
- **Web:** Astro 7, React 19 + Solid.js islands, TanStack Router/DB/Query/Form, Tailwind v4
- **SDK:** Framework-agnostic Vite-built widget (Floating UI positioning)
- **Tooling:** pnpm 11, Turborepo, Biome, Ultracite, TypeScript 6
- **Infra/Deploy:** Docker, Cloudflare (Workers/Pages via Alchemy + Wrangler)

## Prerequisites

- Node.js `^26.4.0`
- pnpm `^11.0.3`
- Docker (for local Postgres / MinIO / SMTP) — optional but recommended

## Getting started

1. Install dependencies:

   ```sh
   pnpm install
   ```

2. Copy the environment file and fill in values:

   ```sh
   cp .env.example .env
   ```

   Required configuration includes `DATABASE_URL`, `AUTH_ENCRYPTION_KEY`, `APP_URL`, `API_URL`, `APP_ROOT_DOMAIN`, SMTP settings, and media upload (S3-compatible) settings. See `.env.example` for details.

3. Start local infrastructure (Postgres / MinIO / mail) and run migrations + seed:

   ```sh
   pnpm db:start
   pnpm db:migrate
   pnpm db:seed
   ```

4. Run the dev servers (API + web in parallel via Turbo):

   ```sh
   pnpm dev
   ```

   Or run individually:

   ```sh
   pnpm dev:server   # API on http://localhost:3000
   pnpm dev:web      # Dashboard on http://localhost:3001
   ```

## Common scripts

| Script | Description |
| --- | --- |
| `pnpm dev` | Run all dev tasks across the workspace |
| `pnpm dev:server` / `pnpm dev:web` / `pnpm dev:native` | Run a single app |
| `pnpm build` | Build all packages and apps |
| `pnpm check-types` | Typecheck the whole workspace |
| `pnpm db:push` | Push schema to the database |
| `pnpm db:generate` | Generate SQL migrations from schema changes |
| `pnpm db:migrate` | Run pending migrations |
| `pnpm db:seed` | Seed the database with sample data |
| `pnpm db:studio` | Open Drizzle Studio |
| `pnpm db:nuke` | Drop and recreate the database |
| `pnpm db:start` / `pnpm db:stop` / `pnpm db:down` | Start/stop/teardown local DB container |
| `pnpm deploy` | Deploy via the infra package (Alchemy/Cloudflare) |
| `pnpm destroy` | Tear down deployed infrastructure |
| `pnpm format` | Format with Biome |
| `pnpm check` / `pnpm fix` | Ultracite lint check / autofix |

## Feedback widget SDK

The embeddable SDK lives in `packages/sdk` and ships ESM + UMD builds. See [`packages/sdk/README.md`](./packages/sdk/README.md) for installation and usage.

## Deployment

Production deployments use the Docker images referenced in `docker-compose.yml` (`ghcr.io/g3root/feeblo-server` and `ghcr.io/g3root/feeblo-web`). Cloudflare deployments are managed via Alchemy and Wrangler configuration in `apps/web`. Use `pnpm deploy` / `pnpm destroy` to provision and remove infrastructure.

## License

Copyright © Feeblo contributors. Distributed under the [GNU Affero General Public License v3.0](./LICENSE).
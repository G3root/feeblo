## About Feeblo

Feeblo is a customer feedback platform for collecting ideas, organizing feature requests, sharing product updates, and keeping users informed about what is shipping next. It gives teams a single place to run public feedback boards, prioritize discussions, publish changelogs, and maintain a clear roadmap without scattering product communication across multiple tools.

## Features

- Feedback boards with active and backlog views
- Posts, comments, reactions, upvotes, and status tracking
- Changelog drafting and publishing
- Roadmap management
- Organizations, memberships, and workspace settings
- Auth flows including sign-in, sign-up, email verification, and invitations
- Billing and plan entitlements
- Public pages and subdomain-based site routing


## Workspace

- `apps/web` - Astro app with the dashboard and public pages
- `apps/server` - Node/TypeScript server built with `rolldown`
- `packages/domain` - shared domain logic, schemas, repositories, and RPC handlers
- `packages/auth` - auth client and server helpers
- `packages/rpc-client` - shared RPC client package
- `packages/transactional` - email templates and mailer utilities
- `packages/config` - shared TypeScript and Effect config

## Requirements

- `pnpm@11`
- Node.js compatible with the workspace dependencies
- A root `.env` file for local app startup

## Install

```bash
pnpm install
```

## Development

Run everything:

```bash
pnpm dev
```

Run a single app:

```bash
pnpm dev:web
pnpm dev:server
```

The web app runs through Astro and defaults to port `3001`.

## Database And Local Services

Local development services are defined in [`docker/docker-compose.dev.yml`](/Users/nfs/Developer/feeblo/docker/docker-compose.dev.yml):

- Postgres on `54323`
- Mailpit on `8025`
- MinIO API on `9002`
- MinIO console on `9001`

Production-style app containers are defined in [`docker-compose.yml`](/Users/nfs/Developer/feeblo/docker-compose.yml).


## Repo Activity

![Alt](https://repobeats.axiom.co/api/embed/5cf64531395bac57da68b318c4e0ae09ad9b194b.svg "Repobeats analytics image")

## License

This project is licensed under the **[AGPL-3.0](https://opensource.org/licenses/AGPL-3.0)** for non-commercial use. 

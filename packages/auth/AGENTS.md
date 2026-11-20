# @feeblo/auth

better-auth wiring: `config.ts`, the Drizzle adapter in `src/adapter/`, the plugins in `src/plugins/`, the organization ACL in `organization-roles.ts`, and the client in `auth-client.ts`. The session and API-key seams that domain code depends on live in `@feeblo/domain` (`session-middleware.ts`, `auth-handler.ts`, `api-key/`), not here.

This package is on the credential surface, so every change in it needs owner sign-off. That covers `packages/domain/src/session-middleware.ts`, `auth-handler.ts`, `public-api/` and `api-key/` too.

## Rules

- A machine credential must never resolve into a member session. API keys authenticate through the key seam in `auth-handler.ts`; `session-middleware.ts` is for browsers only.
- The organization ACL is a plugin concern. Adding a role means changing `organization-roles.ts` and the permission catalog in `@feeblo/permissions` together, since the frontend reads the second.
- Plugin tables and columns are better-auth's contract. Read the plugin's own source in `node_modules` before changing an adapter query, because the query builders in `src/adapter/query-builders.ts` mirror shapes it owns.
- Sessions carry the member and organization identity domain handlers read; a plugin callback that mints one brands it at that boundary rather than letting a bare string travel.

## Tests

`src/api-key.test.ts` shares one PGlite database across the file and hands it to the adapter as a plain value, so it is the one documented exception to `it.effect`. Its `oxlint-disable` carries the reason inline, and new tests in this package use `it.effect` like everywhere else.

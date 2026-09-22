# ADR 0003: Organization-owned API keys for the Public API

## Decision

Public API credentials are **organization-owned machine keys**. `@better-auth/api-key` — pinned to the same version as `better-auth` — owns the credential material: generation, hashing at rest, the stored key format, expiry, scope storage, and verification. Feeblo owns authorization, and the dashboard reads and revokes its own `apikey` rows through a typed, org-scoped repository. The plugin's session mocking (`enableSessionForAPIKeys`) stays off, and so does its per-key rate limiter, in favour of the Redis-backed `RateLimitService`. Keys carry scopes drawn from a Public API vocabulary owned in `packages/domain`, passed to the plugin as statements.

## Why

The alternative — user-owned keys that act as the member who created them — makes every public request's authorization depend on member lifecycle: role changes, removal, and organization membership all silently change what a machine credential can reach, and the key inherits a human's data reach. That is the privilege conflation that produces cross-tenant and data-exposure regressions. Session mocking has the same defect from the other direction: a key that becomes a session inherits session semantics (SSO restriction, membership lists) that were never designed for machine callers.

The plugin is used rather than hand-rolled because key hashing, format, expiry, and revocation are exactly where homegrown key stores fail. `@better-auth/api-key@1.7.2` peers `better-auth: ^1.7.2`, which is the version this repository pins, so adopting it implies no upgrade. Its limiter is unused because it increments counters in its own storage on every request, while production already requires Redis so rate limits are shared across instances — one rate-limit implementation, keyed per key rather than per IP, is both cheaper and less surprising.

## Consequences

Adding the plugin mounts `/api/auth/api-key/*` on the auth router, reachable by any session. Each of those endpoints authorizes itself through the organization ACL — the plugin evaluates `hasPermission({ permissions: { apiKey: [action] } })` on the acting member's role — so `organizationAccessControl` carries an `apiKey` statement, granted to owner and admin and to no other role. That grant is load-bearing: without it every role except the organization creator is denied, and with it a manager cannot mint a workspace credential even though the endpoint is reachable. It is verified in `packages/auth/src/api-key.test.ts`, which exercises the happy path as an admin rather than the creator, because better-auth's `allowCreatorAllPermissions` would mask a missing grant for the creator.

The plugin's own `list`, `get`, and `delete` endpoints require a session on the request, so dashboard listing and revocation are org-scoped row operations in `ApiKeyRepository` instead of calls to those endpoints. Creation and verification are server-side calls the plugin expects: `verifyApiKey` is registered as a server-only endpoint that is never mounted over HTTP, and `createApiKey` receives the acting user id in its body because a call carrying request headers is treated as a client call that may not set scopes.

A workspace whose plan drops keeps its keys. Requests fail with `PLAN_REQUIRES_UPGRADE` rather than the key being disabled, so a billing event cannot become an outage that outlives the billing event. Creating keys is blocked on Free; listing and revoking them is not, so a downgraded workspace can still clean up.

The `apikey` table is a new Drizzle model in `packages/db/src/schema/auth.ts` and must be registered in the adapter's schema map in `packages/auth/src/server.ts`. better-auth's model name is `apikey` — lowercase, singular — and its `referenceId` holds the organization id, with a cascading foreign key so a misconfigured user reference fails loudly instead of inserting.

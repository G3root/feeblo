# Public API Plan

> **Status:** slices 1–7 implemented — vocabulary, credential plumbing, dashboard key-management RPCs, the `/api/v1` surface, the PII-free projection, the detail endpoint, and per-key rate limiting, with tests. Verified: `pnpm check-types` 29/29, `pnpm test` 21/21 tasks, `pnpm lint` and `pnpm fmt` clean. The Settings → Developers page and the `public-api/**` lint boundary are implemented too; the Playwright spec is written and typechecked but could not be executed here — the harness fails at workspace creation for every spec in this environment (`webhooks.spec.ts` fails identically), so it is unverified until CI runs it. Decisions below are settled; the ADRs `docs/adr/0003-organization-owned-api-keys.md` and `docs/adr/0004-public-api-contract-is-hand-written.md` record the two that are hard to reverse. The shipped contract reference is `docs/public-api.md`.

## Objective

Ship the first endpoint of a **Public API**: a versioned, key-authenticated HTTP surface at `/api/v1` where a workspace reads its own data programmatically. It is gated to paid plans, and the security work — not the endpoint — is the deliverable: a workspace credential must never become a member session, and a public response must never carry personal data or internal identifiers.

Two invariants drive every decision below:

1. **A key is the workspace, never a person.** Authorization is scope-based and org-scoped, with no member lifecycle in the path.
2. **Sharing happens below the wire, never at the wire.** Repositories, rate limiting, and plan gating are shared; response schemas and serialization are not.

## Product Decisions

| Decision | Outcome |
| --- | --- |
| Surface | `Public API` — versioned `/api/v1`, key-authenticated. Distinct from the _public portal_ (open to anyone) and the dashboard RPC. |
| Versioning | Version is the path prefix. Additive-only within v1; breaking changes are `/api/v2`. |
| Credential | Organization-owned machine key (`references: "organization"`), scopes drawn from a Public API vocabulary. No user-owned keys. ADR 0003. |
| Plan gate | New capability `publicApi`: `false` on Free, `true` on Starter and Professional. Gated at key creation **and** per request. |
| Downgrade | Keys retained, not disabled, not deleted. Requests return `403 PLAN_REQUIRES_UPGRADE`; upgrading restores service with no rotation. |
| v1 endpoints | `GET /api/v1/boards/{boardId}/posts`, `GET /api/v1/posts/{postId}`. Read-only. |
| Board visibility | A key reads every board in its workspace, private included. The portal's visibility rules gate public visitors, not the workspace's own credential. |
| Contract ownership | Hand-written closed schemas in the public module. Never derived from dashboard or portal schemas. ADR 0004. |
| Rate limiting | Existing Redis-backed `RateLimitService`, keyed on the API key id. The plugin's per-key limiter is disabled. |
| OpenAPI | Separate `PublicApi` instance with its own public `openapiPath`. The internal `Api` document is never published. |
| Key management | Dashboard RPCs (`ApiKeyCreate`/`ApiKeyList`/`ApiKeyRevoke`) behind a new `apiKeys.manage` permission, admin/owner only. |

## Existing Foundation

- **Transport pattern** — `HttpApiGroup` + `HttpApiEndpoint` + OpenApi annotations, as in `packages/domain/src/media/api-contract.ts` and `widget/api-contract.ts`.
- **Context-providing middleware** — `HttpApiAuthMiddleware` (`session-middleware.ts`) is the template for a group-level middleware that `provides` a value and fails with a typed error.
- **The auth seam** — `Auth` (`{ handler, api: { getSession } }`) is provided at composition (`apps/server/src/app/layers.ts#makeAuthLayer`) from `initAuthHandler`. `@feeblo/domain` does **not** depend on `@feeblo/auth`, so this service is the only place the plugin's server API can be reached from domain code.
- **Rate limiting** — `RateLimitService` over Effect's Redis `RateLimiter`; `withPublicHttpRateLimit` is the HTTP-side helper; production startup already requires `REDIS_URL` so limits are shared across instances.
- **Plan vocabulary** — `PLAN_ENTITLEMENTS` (`packages/domain/src/plan-entitlements.ts`) and `EntitlementPolicy` (`entitlement/policies.ts`); `canUseWidgetSso` is the closest precedent.
- **Permission vocabulary** — `PERMISSION_ACTIONS` + `role-permissions.ts` in `@feeblo/permissions`, mirrored to the frontend through `can()`. `docs/permissions.md` already promises the row _"Developer — Manage API/SSO keys"_ for admin/owner; no permission implements it yet.
- **Secret-shown-once precedent** — `jwt-secret` (`JwtSecretWithSecret`, rotate/revoke RPCs, admin-only).
- **PII precedent** — `integrations/webhook/src/webhook-payload.ts`: _"deliberately excludes emails, post content, and credentials"_, and reduces end users to `{ type: "end_user" }`.
- **Boundary-lint precedent** — `oxlint.config.ts` already carries an `eslint/no-restricted-imports` override for "client code must not import `@feeblo/db`".
- **Aggregate precedent** — `og-image/repository.ts`'s `count(upvoteTable.id)`; the only vote-count query in the codebase.

## Architecture

```
apps/server/src/app/router.ts
  makeMergedRoutes()
    ├── HttpRoute              internal HttpApi (unversioned, dashboard RPC + portal)
    ├── PublicApiRoute         NEW — HttpApi.make("PublicApi"), prefix /api/v1,
    │                          openapiPath /api/v1/openapi.json, mounted in production
    └── BetterAuthRouterLive   /api/auth/*   (plugin mounts /api/auth/api-key/*)

packages/domain/src/public-api/     NEW — external surface
  schema.ts          hand-written v1 DTOs (closed structs)
  api-contract.ts    PublicApi instance + PublicApiGroup + ApiKeyAuthMiddleware
  api-live.ts        handlers; the only place repositories are read
  mappers.ts         pure row → DTO functions
  repository.ts      public-only projections (no actor-identity columns)
  errors.ts          PUBLIC_API_ERROR_CODES + mapping
  middleware.ts      ApiKeyAuthMiddleware implementation

packages/domain/src/api-key/        NEW — dashboard management surface
  schema.ts          ApiKeyCreate / ApiKeyList / ApiKeyRevoke payloads
  rpcs.ts            ApiKeyRpcs (added to AllRpcs)
  handlers.ts        calls Auth.api.*ApiKey, enforces apiKeys.manage + plan
```

### Request path

```
x-api-key ─▶ ApiKeyAuthMiddleware
              ├─ missing header           → 401 MISSING_API_KEY
              ├─ auth.api.verifyApiKey    → 401 INVALID_API_KEY (unknown/revoked/expired/disabled)
              ├─ referenceId → organization, plan via EntitlementPolicy.canUsePublicApi
              │                            → 403 PLAN_REQUIRES_UPGRADE
              ├─ scope check              → 403 FORBIDDEN_SCOPE
              └─ provides PublicApiCaller { organizationId, keyId, scopes }
                 ─▶ handler ─▶ repository projection ─▶ mapper ─▶ closed DTO ─▶ encode
                                                     ▲
                                     RateLimitService.consume(keyId) before the handler
```

The middleware deliberately provides **`PublicApiCaller`**, not `CurrentSession`. Nothing downstream can reach session semantics.

## Data Model Changes

### `apikey` (new, `packages/db/src/schema/auth.ts`)

Better-auth's model name is `apikey` (lowercase, singular) and the column set is the plugin's; only the table is ours to declare, in the repo's `snake_case` + `timestamp(..., { withTimezone: true })` convention.

| Column | Notes |
| --- | --- |
| `id` | text, primary key |
| `config_id` | text, not null, default `'default'`; indexed |
| `name`, `start`, `prefix` | display only; `start` is the first characters of the key |
| `reference_id` | **organization id**; not null; indexed |
| `key` | hashed; not null; indexed |
| `enabled` | boolean, default true |
| `expires_at` | nullable; v1 keys do not expire by default |
| `permissions` | JSON text; the key's scope statements |
| `metadata` | unused; `enableMetadata: false` |
| `last_request` | updated by `verifyApiKey` |
| `rate_limit_*`, `request_count`, `remaining`, `refill_*` | present for schema compatibility; the plugin's limiter is **disabled**, so these stay at defaults |

Registration: the `drizzleAdapter(db, { schema: { … , apikey: schema.apiKeyTable } })` map in `packages/auth/src/server.ts` must gain `apikey`, and `schema/index.ts` must export it, or better-auth fails at runtime with _"The model \"apikey\" was not found in the schema object"_.

### Unchanged on purpose

No existing table gains a column. No existing RPC changes shape. The widget API and the public portal are untouched.

## Code Sharing Rules

This is the part of the plan that prevents regressions, so it is stated as rules with enforcement, not as guidance.

### Shared

- Drizzle schema and `packages/db` migrations.
- `Policy`, `EntitlementPolicy`, `RateLimitService`, `@feeblo/permissions`.
- `Database`, and the query patterns a reader can copy — but not `PostRepository`'s methods. The public projection is a different query with different rules (no visibility filter, aggregates the portal never needs), so it lives in `public-api/repository.ts`. Divergence there is deliberate; divergence in _payload shaping_ is what the guards below prevent.
- Error constructors from `rpc-errors.ts` for transport status mapping only — never their `identifier` strings as public codes.

### Never shared

- `PostRepository`'s read methods and `post/schema.ts` (`PostListItem`, `Post`), `widget/schema.ts`, and any other dashboard/portal response schema.
- `public-actor.ts` and its redaction helpers.
- `session-middleware.ts` — the public module must not be able to resolve a `CurrentSession`.

### Four guards

1. **PII never leaves the database.** The public projections select explicit columns and simply do not select `creator_id`, `creator_member_id`, `contact_id`, or any user email. This is stronger than redacting after the fact: the data never enters the handler's memory, so no later logging, mapping, or error message can leak it.
2. **Closed DTOs.** Every public response is a hand-written `Struct`, and every response is encoded through its schema, so an unexpected property is dropped rather than serialized.
3. **Narrow mapper inputs.** Each mapper takes a hand-declared interface naming exactly the fields it reads (`PublicPostSource`), so a field added to a dashboard row cannot flow through. Widening a public payload requires editing the DTO _and_ the mapper — two edits, both visible in review.
4. **Lint boundary.** An `oxlint.config.ts` override for `packages/domain/src/public-api/**` forbidding imports of `post/schema`, `widget/schema`, `public-actor`, and `session-middleware`, with a message explaining that sharing a response schema is what leaks PII.

Plus two tests:

- **Spec guard** — walk the generated `/api/v1/openapi.json` and fail if any property path matches `email|phone|userId|memberId|creatorId|contactId|secret|token|ip`, unless allowlisted in the test with a comment justifying it.
- **Shape snapshot** — serialize one post per endpoint and snapshot it. Any new field is a diff in the PR, which is the tripwire that catches the case the type system cannot.

### Do not

- Do not return a `PostListItem` or any other dashboard row, even "just for the ids".
- Do not call `redactCreatorIdentity`. It is session-aware and nulls fields instead of omitting them; a machine key has no session user.
- Do not add `organizationId` to item payloads. The key is org-scoped, so it is redundant, and a public payload that carries an org id invites a future filter parameter that must then be validated.
- Do not reuse internal error identifiers as public codes. `PolicyDeniedError`, `PostServiceErrors` members, and `UnauthorizedError` describe internals and change freely.

## Authorization and Plan Gating

### The seam for the plugin

`AuthHandler.api` exposes `getSession` to domain code. It now also exposes `createApiKey` and `verifyApiKey`, which keeps `packages/domain` free of a dependency on `packages/auth` (the dependency runs auth → domain). Two implementation constraints shape the seam:

- The declared signatures must be narrow singletons, because better-auth registers overloaded endpoints — one of which demands `asResponse: true` — so the raw callables are not assignable to a single-signature type. `toAuthHandler` in `packages/auth` adapts them, and normalizes `verifyApiKey`'s four-way result union down to `{ valid, key }`.
- Neither call may carry request headers. `createApiKey` treats a header-bearing call as a client call and then rejects `permissions` (the key's scopes), so the acting user travels in the body and the plugin re-checks that user's membership and ACL role. `verifyApiKey` is server-only and never mounted over HTTP.

### Scope vocabulary

`{ posts: ["read"], boards: ["read"] }`, passed to the plugin as `permissions` and checked per endpoint. Defined in `public-api/schema.ts` and exported as a literal union, never generated from `@feeblo/permissions`: that catalog is mutation-oriented (`posts: ["update", …]`, no read action) and is shared with the frontend, so extending it would change a member-authorization vocabulary to serve a machine credential. `apiKeys.manage` governs _who may grant_ a scope; scopes govern _what the key may do_. Those are separate axes and must not be merged.

### Plugin endpoint gate (regression #1)

Adding the plugin mounts `/api/auth/api-key/*`, reachable by any session. Those endpoints authorize themselves through the organization ACL: the plugin evaluates `hasPermission({ permissions: { apiKey: [action] } })` on the acting member's role. `organizationAccessControl` therefore carries an `apiKey` statement granted to owner and admin only — without it every role except the organization creator is denied, so the grant is what makes the endpoints usable at all, and its absence for manager and contributor is what stops them being abused. No `hooks.before` path gate is needed: the ACL is the plugin's own extension point, covers every endpoint uniformly including ones added later, and has no path-prefix blind spot.

That check runs inside the plugin, so it applies equally to calls through `ApiKeyCreate` and to a hand-rolled request to the auth router. `packages/auth/src/api-key.test.ts` proves both directions: an admin creates a key, a manager is refused and writes nothing. The happy path is exercised as admin rather than the organization creator, because better-auth's `allowCreatorAllPermissions` would mask a missing admin grant.

### Session-bound plugin endpoints

The plugin's `list`, `get`, and `delete` endpoints require a session (`use: [sessionMiddleware]`, then `ctx.context.session.user.id`). A dashboard RPC handler has no better-auth request context, so reaching them would mean reconstructing a session cookie inside the handler. Instead `ApiKeyRepository` lists and revokes `apikey` rows directly — org-scoped by `reference_id` in the delete predicate — while creation and verification use the plugin's server-side entry points. `verifyApiKey` is registered as a server-only endpoint the plugin never mounts over HTTP, so a bearer key cannot be validated by reaching it.

### Plan gate placement

`EntitlementPolicy.canUsePublicApi(organizationId)` — a sibling of `canUseWidgetSso`. Called at key creation (so a Free workspace cannot mint credentials) and on every request (so a downgrade cannot be outrun by a key created moments earlier).

## Framework notes (learned the hard way)

Three behaviours of `effect/unstable/httpapi` in this version are load-bearing for the Public API, and each was found by a failing test rather than by reading:

1. **Declare error schemas as an array, never as one `Schema.Union`.** `HttpApiEndpoint.getErrorSchemas` treats each declared entry as one schema and resolves `httpApiStatus` from its own AST; a union is a single entry carrying no status, so every error it contains is answered as `500` and the published document lists only `200` and `500`. Declaring `error: PUBLIC_API_ERROR_SCHEMAS` fixes both. The dashboard's other HTTP APIs still declare unions, so they still answer errors as `500` — worth fixing when each is next touched.
2. **A handler's service requirements are not satisfied by providing to the route layer.** They surface as `Request<"Requires", …>` and must be provided where the server is assembled (`makeServiceLayers`). Handlers therefore read their services from the fiber context (`currentPublicApiRepository`, `currentPublicApiConfig`, mirroring `currentHttpApiSession`), which keeps the route layer free of unsatisfiable requirements.
3. **A header schema attached to an error response is honoured at runtime but not reflected in the generated document.** `Retry-After` on the 429 is real — asserted at runtime, promised in `docs/public-api.md` — but the OpenAPI document does not describe it.

## Rate Limiting

`publicApiKeyLimits = { read: { limit: 300, window: "1 minute" } }` (a starting value; it is documented in `docs/public-api.md`, so changes are customer-visible). Consumption is keyed `public-api:key:{keyId}` through `RateLimitService`, before the handler runs. The plugin's own limiter is disabled with `rateLimit: { enabled: false }` so there is one implementation and one store. Exhaustion maps to `RATE_LIMITED` with `Retry-After`; an unavailable limiter maps to `SERVICE_UNAVAILABLE`, matching the existing fail-closed behavior of `makePublicRpcRateLimiter`.

## Key Management

- **Permission** — `apiKeys: ["manage"]` in `PERMISSION_ACTIONS`, granted to admin and owner in `role-permissions.ts`, mirrored as the `apiKey` statement in better-auth's organization ACL; the `docs/permissions.md` matrix row now points at an implemented permission.
- **RPCs** — `ApiKeyCreate` (name), `ApiKeyList`, `ApiKeyRevoke`, gated by `ApiKeyPolicy`.
- **Plaintext once** — creation returns the full key exactly once, like `JwtSecretWithSecret`; the list never returns it, and the database stores only the plugin's base64url SHA-256 digest plus the `start` characters.
- **Configuration** (`packages/auth/src/api-key-config.ts`, shared with the tests so the tested configuration is the shipped one) — `references: "organization"`, `defaultPrefix: "fbk_"`, `enableMetadata: false`, `keyExpiration.defaultExpiresIn: null`, `startingCharactersConfig.shouldStore: true`, `rateLimit.enabled: false`, no `enableSessionForAPIKeys`.
- **UI** — Settings → Developers (`apps/web/src/dashboard/features/api-key/`, route `settings/developers.tsx`, sidebar entry gated on `apiKeys.manage`): create through a sheet with the server's own name bound, the one-time key in a warning panel, list with `fbk_ab…`, scopes, created and last-used, revoke behind an `AlertDialog`, and the base URL plus OpenAPI link. Built on **Effect Atom** (`DashboardClient.query`/`mutation` + `useAsyncList`), not a TanStack DB collection: credentials are server-authoritative, revocation must never look applied before the server agrees, and the create response carries a secret that must not enter a client-side store. The webhook endpoints page — an org-scoped credential list with a one-time secret — is built the same way for the same reasons.

## Observability

- `last_request` is updated by `verifyApiKey`; it is the only per-request write and it is what the dashboard shows as "last used".
- Log lines carry `{ keyId, organizationId, route, status }` and never the key, the header, or any end-user field.
- Error reporting must not attach request headers; the `x-api-key` value is credential material.
- `enabled` is never flipped by the plan gate — usage and billing state stay distinguishable in the key list.

## Testing Strategy

**Mapper and schema tests** — a mapper cannot emit a field the DTO does not declare; an extra property on the source is dropped by the closed struct; `author` is always `{ type, displayName, avatarUrl }`.

**Middleware tests** — missing, malformed, unknown, revoked, expired, and disabled keys; a valid key on the wrong plan; a key missing a scope; a key for org A asked for org B's board id returns `404` and never `403` (no existence oracle).

**Contract tests** — the spec guard over `/api/v1/openapi.json`; response shape snapshots; a test asserting the public route set is exactly the documented one, so an accidentally added endpoint fails the build.

**Rate-limit tests** — consumption is keyed by key id; exhaustion returns `429` with `Retry-After`; an unavailable limiter returns `503`.

**E2E** (`e2e/tests/public-api.spec.ts`) — Free plan: page hidden, key creation rejected, and a directly crafted request rejected; upgrade → create key → list posts → assert the payload has no email or `usr_`/`mem_` id; downgrade → `403 PLAN_REQUIRES_UPGRADE` → re-upgrade → same key works; revoke → `401 INVALID_API_KEY`.

## Implementation Slices

Each slice is independently shippable and leaves the system consistent.

1. **Vocabulary.** ✅ `publicApi` capability in `plan-entitlements.ts` (plus the pricing catalog and schema); `EntitlementPolicy.canUsePublicApi`; `apiKeys.manage` in `@feeblo/permissions` + `role-permissions.ts`; `docs/permissions.md` updated.
2. **Credential plumbing.** ✅ `apikey` Drizzle model + migration; `packages/auth/src/api-key-config.ts` shared by server and tests; adapter schema map; `AuthHandler.api` widened for `createApiKey`/`verifyApiKey` with `toAuthHandler` adapting the plugin's overloaded signatures; `apiKey` statements in the organization ACL.
3. **Management surface.** RPCs, handlers, `ApiKeyPolicy`, `ApiKeyRepository`, and both test files ✅. Settings → Developers page ⬜.
4. **Public skeleton.** ✅ `PublicApi` instance, `/api/v1` prefix, its own `openapiPath`, `ApiKeyAuthMiddleware`, error vocabulary, mounted in `makeMergedRoutes`, served in every environment.
5. **The projection.** ✅ `public-api/repository.ts` (actor identity reduced to a classification in SQL, counts, tags), `mappers.ts`, closed DTOs, `api-contract.test.ts` + `mappers.test.ts` as the shape and PII locks. The lint override is still ⬜ — the guards that exist today are the closed structs, the narrow mapper inputs, the exact-key tests, and the runtime PII search.
6. **Detail endpoint.** ✅ `GET /api/v1/posts/{postId}` with `content`; another workspace's id answers `404`.
7. **Rate limiting.** ✅ Per-key limits through the Redis `RateLimitService`, `Retry-After` on 429, `503` fail-closed, the limit documented, and the limit injectable so a test can exhaust it.
8. **E2E and docs.** `docs/public-api.md` ✅ reconciled against what ships (envelope, scopes, statuses). Dashboard page ✅. `e2e/tests/public-api.spec.ts` ✅ authored: a free workspace sees the plan message and a disabled action, a Starter workspace creates a key, uses it against `/api/v1` (404 `NOT_FOUND` with the key, 401 `MISSING_API_KEY` without it), then revokes it and sees 401 `INVALID_API_KEY`. Execution is blocked by the harness, not the spec — see the status note above. The `public-api/**` lint boundary is ✅ in `oxlint.config.ts`, verified by a probe file that fails lint as intended.

## Non-goals for the First Version

Writes of any kind. User-owned or personal keys. OAuth applications and delegated access. A generated typed client or SDK. `end_users.read` and any endpoint returning contact data. Per-key IP allowlists. Audit-log export. Sorting, tag filters, or search on the list endpoint. Offset pagination. Keys visible to non-admin members. Rate-limit data exposed per key beyond `Retry-After`.

## Completion Criteria

- The _"Developer — Manage API/SSO keys"_ row in `docs/permissions.md` is implemented, not merely documented, and both the dashboard and `/api/auth/api-key/*` enforce it.
- A Free workspace cannot create a key and cannot make a successful request; the failures are distinguishable by code.
- No public response can contain an end-user email, an internal actor id, or credential material — demonstrated by the spec guard, and by the query selecting no such columns.
- Lint fails when `public-api/**` imports a dashboard/portal response schema or the session middleware.
- A downgrade does not break a customer's integrations permanently: the same keys work after upgrading.
- `docs/public-api.md`, the served OpenAPI document, and the implementation agree.

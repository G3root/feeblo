# ADR 0024: MCP OAuth is a second credential for the same caller

## Decision

`POST /mcp` accepts two credentials, and both resolve to one `PublicApiCall`:

- **`x-api-key`** — unchanged. `authenticatePublicApiKey` verifies the key, charges its per-key budget, and applies the plan gate (ADR 0008).
- **`Authorization: Bearer <jwt>`** — an OAuth 2.1 access token issued by this deployment acting as its own authorization server. `authenticateMcpAccessToken` verifies the token against the deployment's JWKS, charges a per-(member, workspace) budget, applies the same plan gate, and maps the token's `scope` claim to the same `PublicApiScopeStatements` the key path produces.

`/api/v1` stays key-only. The OAuth grant is bound to the MCP resource identifier (`https://api.<domain>/mcp`), so it is a credential for the MCP surface, not a second way into the versioned HTTP API.

The authorization server is Better Auth's `mcp()` plugin (`@better-auth/mcp`), with the `jwt()` plugin (required by the provider for signing and `/jwks`) and the `cimd()` plugin (`@better-auth/cimd`, Client ID Metadata Documents). The plugin owns discovery, client registration, PKCE authorization, consent, token issuance and refresh, and protected-resource metadata. Feeblo owns everything that decides what a token may do.

**The workspace is chosen at consent, not carried by the client.** `postLogin.consentReferenceId` returns the session's `activeOrganizationId` after checking membership, and `postLogin.shouldRedirect` sends a member who belongs to more than one workspace (or has none active) to `/oauth/select-workspace` before consent. The workspace is emitted as the namespaced claim `https://feeblo.com/workspace` by `customAccessTokenClaims`, and `authenticateMcpAccessToken` requires it. A token without a workspace claim is refused, not defaulted.

**Only a member who may mint a workspace key may authorize a grant.** The consent's workspace reference requires the organization ACL statement the API-key plugin checks (`apiKey: ["create"]`, granted to owner and admin), and every access token re-checks the member's role, so a demotion stops an existing grant. Without that gate any member could consent to scopes their own role does not hold — `companies.delete`, for a contributor — and then call the Public API with the token.

**Scopes are the Public API's own vocabulary.** The provider's `scopes` list is `openid`, `profile`, `email`, `offline_access`, plus every member of `PUBLIC_API_SCOPES`. The MCP middleware maps the token's `scope` claim through `toPublicApiScopeStatements`, dropping OIDC scopes it does not understand. The operation's own `requirePublicApiScope` remains the authority, so a token and a key are refused by the same code.

**Both client-registration mechanisms are enabled.** CIMD is the MCP 2026-07-28 mechanism and the one to prefer. Dynamic client registration is also enabled, because current MCP clients (Cursor, older Claude Code) still register dynamically, and a consent flow that fails at registration is not a working integration. The mitigations are explicit: consent is never skipped, redirect URIs are exact-matched, registration is rate-limited by the plugin's own endpoint budget, the MCP resource and its scopes are the default registration ceiling, and a registered client grants nothing until a member consents for a specific workspace.

## Why

**The friction this removes is the only friction.** The MCP surface exists and works with a key (ADR 0008). Pasting a key into an MCP client is the step that hosted clients are moving away from: Claude's connectors, ChatGPT's apps, and Cursor's remote MCP all discover an authorization server from RFC 9728 metadata and run authorization-code-with-PKCE. Without an authorization server, those clients cannot connect at all, and the key path cannot be made to look like one.

**The mismatch is only apparent.** OAuth grants are user-scoped and the Public API is workspace-scoped, which is exactly what `consentReferenceId` exists to bridge: it is the provider's hook for "which tenant is this grant for", it is stored with the consent, and it is what the provider hands `customAccessTokenClaims` on every refresh. Reusing the session's `activeOrganizationId` means the workspace a member already selected in the dashboard is the workspace they authorize, and selecting a different one is the ordinary workspace switcher.

**One caller, two credentials, and the check stays in one place per credential.** ADR 0008 made `authenticatePublicApiKey` the unit so the HTTP and MCP surfaces could not drift. Adding a second credential could have reintroduced that drift inside `/mcp`. It does not, because the OAuth path is a sibling function that produces the same value, and the middleware dispatches on the presented credential before either runs. The plan gate, the rate-limit headers, and the scope check are downstream of the produced caller, so they are shared by construction.

**The verification belongs beside the auth instance.** `verifyAccessTokenRequest` and `createResourceServerChallenge` are Better Auth/`oauth2` API surface, and `packages/domain` must not import Better Auth (the dependency runs auth → domain). The seam grows one narrow method — claims or a challenge, never a library value — and `packages/auth` keeps the issuer, audience, JWKS URL, and challenge semantics.

**The per-key budget had to become per-grant.** A key is a workspace credential, so `public-api:key:<keyId>` is the right bucket. An OAuth token is a member acting in a workspace, and the same member may authorize several clients; bucketing by token id would let a client mint tokens to multiply its budget. The bucket is therefore the grant's subject and workspace, and the published limit and window are unchanged so the `X-RateLimit-*` contract in `docs/public-api.md` still describes every `/mcp` response.

## Consequences

The migration adds the provider's tables — `jwks`, `oauth_client`, `oauth_resource`, `oauth_client_resource`, `oauth_refresh_token`, `oauth_access_token`, `oauth_consent`, `oauth_client_assertion` — beside the existing auth tables. They are the provider's schema, not a Feeblo re-description; the fields are the ones the plugin's own adapter contract requires.

`PublicApiCall.keyId` becomes a `credential` discriminant (`ApiKey` with its id, or `OAuth` with the subject and client id), because a single opaque id could no longer say which kind of authority a request carried. Production code reads only `organizationId` and `scopes`, so the change reaches one test fixture.

An OAuth grant ends where a key can be deleted, but not at the same instant. An MCP client requests a resource, so the provider issues a JWT access token; a JWT cannot be revoked server-side, and `/mcp` verifies it locally against the JWKS, so it stays valid until `accessTokenExpiresIn` — one hour by default. Revoking at `/api/auth/oauth2/revoke` stops the refresh token, and the workspace-membership re-check in `verifyMcpAccessToken` refuses a token whose member has left the workspace. Shortening the access-token lifetime is the remaining lever, at a refresh cost. The `PublicApiCall` still never becomes a `CurrentSession` — the MCP handlers read a workspace and a scope set, not memberships or dashboard policies — so ADR 0008's boundary holds.

A workspace deleting its OAuth clients or consents is not part of this change: `oauth_consent` and `oauth_client` reference the user, not the organization, and the consent's workspace is a claim rather than a foreign key. Account deletion still cascades through `userId`; a deleted workspace leaves consents whose claim points at nothing, and those tokens are refused by the plan gate. A follow-up can add an explicit cleanup if the rows prove to matter.

The discovery documents move: `/.well-known/mcp.json` and `/auth.md` advertise OAuth alongside the key, the RFC 9728 document is served by the provider at the API origin, and `apps/server` forwards the issuer-inserted well-known paths to the auth handler because the handler is mounted under `/api/auth/*` while RFC 8414 puts the metadata at the origin root.

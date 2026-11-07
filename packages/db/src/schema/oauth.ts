import {
  boolean,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { sessionTable, userTable } from "./auth";

/**
 * The OAuth 2.1 provider's tables, as `@better-auth/oauth-provider` declares
 * them.
 *
 * The shapes are the plugin's own adapter contract, not a Feeblo
 * re-description: `mcp()` composes that provider, and the drizzle adapter
 * resolves a model by the column property name (`getFieldName`), so a field
 * renamed here is a request that fails at runtime rather than at compile time.
 * Keep the property names identical to the plugin's field names and the SQL
 * names snake_cased, the same convention `auth.ts` uses.
 *
 * See `docs/adr/0024` for why the MCP surface runs an authorization server at
 * all.
 */

/**
 * The JWT plugin's signing keys.
 *
 * `jwt()` requires this table even though it never rotates by default: the
 * provider signs access and id tokens with the key it stores here, and
 * `/.well-known/jwks.json` is what a resource server verifies against.
 */
export const jwksTable = pgTable("jwks", {
  id: text("id").primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  alg: text("alg"),
  crv: text("crv"),
});

export const oauthClientTable = pgTable(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    // The registered `client_id`. A dynamically registered client gets a
    // generated one; a CIMD client uses its metadata document URL.
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false).notNull(),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    // The ceiling for `client_credentials` grants. User-delegated scopes never
    // authorize machine access, so this stays empty for every MCP client.
    clientCredentialsScopes: text("client_credentials_scopes")
      .array()
      .default([]),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required"
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens")
      .default(false)
      .notNull(),
    // The client's owner (`consentReferenceId` or an initial access token).
    // For Feeblo this is not the workspace: the workspace is chosen per grant
    // at consent time, so one client can serve several workspaces.
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [
    index("oauthClient_userId_idx").on(table.userId),
    index("oauthClient_referenceId_idx").on(table.referenceId),
  ]
);

/**
 * A protected resource this provider issues tokens for.
 *
 * `mcp()` seeds one row for its `resource` on first use; `allowedScopes` is
 * what narrows a client's requested scope set to what the resource accepts.
 */
export const oauthResourceTable = pgTable("oauth_resource", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes").array(),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean("dpop_bound_access_tokens_required")
    .default(false)
    .notNull(),
  disabled: boolean("disabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
  policyVersion: integer("policy_version").default(1).notNull(),
  metadata: jsonb("metadata"),
});

/** Which client may request which resource (RFC 8707 per-client validation). */
export const oauthClientResourceTable = pgTable(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClientTable.clientId, { onDelete: "cascade" }),
    // Named explicitly: the generator's fallback name for a reference to a
    // non-primary unique column is a random suffix.
    resourceId: text("resource_id").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("oauthClientResource_clientId_idx").on(table.clientId),
    index("oauthClientResource_resourceId_idx").on(table.resourceId),
    uniqueIndex("oauthClientResource_clientId_resourceId_uidx").on(
      table.clientId,
      table.resourceId
    ),
    foreignKey({
      name: "oauth_client_resource_resource_id_fkey",
      columns: [table.resourceId],
      foreignColumns: [oauthResourceTable.identifier],
    }).onDelete("cascade"),
  ]
);

export const oauthRefreshTokenTable = pgTable(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClientTable.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessionTable.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => userTable.id, { onDelete: "cascade" }),
    // The `consentReferenceId` the grant was issued for.
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revoked: timestamp("revoked", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", {
      withTimezone: true,
    }),
    authTime: timestamp("auth_time", { withTimezone: true }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthRefreshToken_clientId_idx").on(table.clientId),
    index("oauthRefreshToken_sessionId_idx").on(table.sessionId),
    index("oauthRefreshToken_userId_idx").on(table.userId),
    index("oauthRefreshToken_authorizationCodeId_idx").on(
      table.authorizationCodeId
    ),
  ]
);

export const oauthAccessTokenTable = pgTable(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: text("token").unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClientTable.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => sessionTable.id, {
      onDelete: "cascade",
    }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    refreshId: text("refresh_id").references(() => oauthRefreshTokenTable.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    revoked: timestamp("revoked", { withTimezone: true }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (table) => [
    index("oauthAccessToken_clientId_idx").on(table.clientId),
    index("oauthAccessToken_sessionId_idx").on(table.sessionId),
    index("oauthAccessToken_userId_idx").on(table.userId),
    index("oauthAccessToken_authorizationCodeId_idx").on(
      table.authorizationCodeId
    ),
    index("oauthAccessToken_refreshId_idx").on(table.refreshId),
  ]
);

/**
 * One member's decision to let one client act in one workspace.
 *
 * `referenceId` is the consent's workspace, so consent is per workspace: a
 * member who authorizes a client in two workspaces has two rows, and a client
 * cannot reuse the first workspace's consent for the second.
 */
export const oauthConsentTable = pgTable(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClientTable.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => userTable.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("oauthConsent_clientId_idx").on(table.clientId),
    index("oauthConsent_userId_idx").on(table.userId),
  ]
);

/**
 * Replay tombstones for `private_key_jwt` client assertions.
 *
 * The provider inserts one row per used `jti`; the primary key is a digest of
 * the assertion's identifiers, so a replay collides atomically across
 * processes. `expiresAt` marks when removal is safe.
 */
export const oauthClientAssertionTable = pgTable("oauth_client_assertion", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export type OAuthClient = typeof oauthClientTable.$inferSelect;
export type OAuthConsent = typeof oauthConsentTable.$inferSelect;

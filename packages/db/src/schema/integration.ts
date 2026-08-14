import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type {
  TGitHubInstallationAccountType,
  TGitHubIssueMatchMode,
  TGitHubIssueState,
  TGitHubUpvoterNotificationPolicy,
} from "../validation-schema/github-integration";
import type {
  TExternalResourceCreateRequestState,
  TIntegrationCapabilityKey,
  TIntegrationConnectionLifecycleStatus,
  TIntegrationDeliveryAttemptDiagnostics,
  TIntegrationDeliveryLastError,
  TIntegrationDeliveryRetryDecision,
  TIntegrationDeliveryState,
  TIntegrationEventType,
  TIntegrationExternalResourceType,
  TIntegrationProviderConfiguration,
  TIntegrationProviderKey,
  TIntegrationRouteEventSelection,
  TIntegrationSafeDisplayMetadata,
  TStoredIntegrationEventOrigin,
  TStoredIntegrationEventPayload,
} from "../validation-schema/integration";
import { organizationTable } from "./auth";
import { postStatusTable, postTable } from "./feedback";

/** Durable organization-owned provider connection with credentials stored separately from safe metadata. */
export const integrationConnectionTable = pgTable(
  "integration_connection",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    provider: text("provider").$type<TIntegrationProviderKey>().notNull(),
    name: text("name").notNull(),
    remoteAccountId: text("remote_account_id"),
    lifecycle: text("lifecycle")
      .$type<TIntegrationConnectionLifecycleStatus>()
      .notNull(),
    credentialGeneration: integer("credential_generation").default(1).notNull(),
    /** Encrypted provider credentials and endpoint values; never safe for list/read responses. */
    credentialsCiphertext: text("credentials_ciphertext"),
    safeDisplayMetadata: jsonb(
      "safe_display_metadata"
    ).$type<TIntegrationSafeDisplayMetadata>(),
    consecutiveExhaustedDeliveries: integer("consecutive_exhausted_deliveries")
      .default(0)
      .notNull(),
    lastSucceededAt: timestamp("last_succeeded_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    retentionExpiresAt: timestamp("retention_expires_at", {
      withTimezone: true,
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      "integration_connection_credential_generation_check",
      sql`${table.credentialGeneration} > 0`
    ),
    check(
      "integration_connection_exhausted_count_check",
      sql`${table.consecutiveExhaustedDeliveries} >= 0`
    ),
    index("integration_connection_organization_provider_idx").on(
      table.organizationId,
      table.provider
    ),
    index("integration_connection_organization_lifecycle_idx").on(
      table.organizationId,
      table.lifecycle
    ),
    uniqueIndex("integration_connection_organization_id_uidx").on(
      table.organizationId,
      table.id
    ),
    // A Discord guild has one global interaction endpoint, so one active
    // guild installation must resolve to exactly one Feeblo organization.
    uniqueIndex("integration_connection_provider_remote_account_active_uidx")
      .on(table.provider, table.remoteAccountId)
      .where(
        sql`${table.provider} = 'discord' and ${table.remoteAccountId} is not null and ${table.lifecycle} = 'active'`
      ),
  ]
);

/** GitHub App installation identity bound one-to-one with an integration connection. */
export const githubInstallationTable = pgTable(
  "github_installation",
  {
    connectionId: text("connection_id")
      .primaryKey()
      .references(() => integrationConnectionTable.id, { onDelete: "cascade" }),
    /** GitHub's durable installation identifier; installation access tokens are never stored. */
    installationId: text("installation_id").notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type")
      .$type<TGitHubInstallationAccountType>()
      .notNull(),
    /** Present while GitHub has suspended the App installation. */
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_installation_installation_id_uidx").on(
      table.installationId
    ),
    index("github_installation_account_idx").on(table.accountId),
  ]
);

/** Provider-owned capability configuration and subscribable event selection. */
export const integrationRouteTable = pgTable(
  "integration_route",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    capabilityKey: text("capability_key")
      .$type<TIntegrationCapabilityKey>()
      .notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    eventTypes: jsonb("event_types")
      .$type<TIntegrationRouteEventSelection>()
      .notNull(),
    /** Provider-defined discriminator for routes sharing a (connection, capability); empty when a capability has one route per connection. */
    routeKey: text("route_key").notNull().default(""),
    configVersion: integer("config_version").notNull(),
    providerConfig: jsonb("provider_config")
      .$type<TIntegrationProviderConfiguration>()
      .notNull(),
    safeDisplayMetadata: jsonb(
      "safe_display_metadata"
    ).$type<TIntegrationSafeDisplayMetadata>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      "integration_route_config_version_check",
      sql`${table.configVersion} > 0`
    ),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        integrationConnectionTable.organizationId,
        integrationConnectionTable.id,
      ],
      name: "integration_route_organization_connection_fkey",
    }).onDelete("cascade"),
    index("integration_route_connection_enabled_idx").on(
      table.connectionId,
      table.enabled
    ),
    index("integration_route_organization_enabled_idx").on(
      table.organizationId,
      table.enabled
    ),
    uniqueIndex("integration_route_organization_id_uidx").on(
      table.organizationId,
      table.id
    ),
    // One route per (connection, capability, routeKey). Capabilities with a
    // single route per connection (webhook events.post, Slack inbound) use an
    // empty routeKey; providers with multiple routes per capability (Slack
    // channel.notifications, future Linear projects, Discord channels) store
    // their own natural discriminator.
    uniqueIndex("integration_route_connection_capability_key_uidx").on(
      table.connectionId,
      table.capabilityKey,
      table.routeKey
    ),
  ]
);

/** Immutable canonical integration event retained independently from delivery attempts. */
export const integrationEventTable = pgTable(
  "integration_event",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    type: text("type").$type<TIntegrationEventType>().notNull(),
    version: integer("version").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    origin: jsonb("origin").$type<TStoredIntegrationEventOrigin>().notNull(),
    causationId: text("causation_id"),
    correlationId: text("correlation_id").notNull(),
    causalHopCount: integer("causal_hop_count").notNull(),
    payload: jsonb("payload").$type<TStoredIntegrationEventPayload>().notNull(),
    retentionExpiresAt: timestamp("retention_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check("integration_event_version_check", sql`${table.version} > 0`),
    check(
      "integration_event_causal_hop_count_check",
      sql`${table.causalHopCount} >= 0`
    ),
    index("integration_event_organization_occurred_at_idx").on(
      table.organizationId,
      table.occurredAt
    ),
    index("integration_event_retention_expires_at_idx").on(
      table.retentionExpiresAt
    ),
    uniqueIndex("integration_event_organization_id_uidx").on(
      table.organizationId,
      table.id
    ),
  ]
);

/** One independently leased, retried delivery of an event to a route. */
export const integrationDeliveryTable = pgTable(
  "integration_delivery",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    connectionId: text("connection_id").notNull(),
    routeId: text("route_id").notNull(),
    eventId: text("event_id").notNull(),
    /** Stable outbound action identity; V1 derives it from the route and event. */
    actionKey: text("action_key").notNull(),
    state: text("state").$type<TIntegrationDeliveryState>().notNull(),
    orderingKey: text("ordering_key"),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
    }).notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    succeededAt: timestamp("succeeded_at", { withTimezone: true }),
    exhaustedAt: timestamp("exhausted_at", { withTimezone: true }),
    canceledAt: timestamp("canceled_at", { withTimezone: true }),
    lastError: jsonb("last_error").$type<TIntegrationDeliveryLastError>(),
    retentionExpiresAt: timestamp("retention_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    check(
      "integration_delivery_attempt_count_check",
      sql`${table.attemptCount} >= 0`
    ),
    check(
      "integration_delivery_lease_state_check",
      sql`(${table.state} = 'leased') = (${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`
    ),
    check(
      "integration_delivery_terminal_timestamp_check",
      sql`(${table.state} = 'succeeded') = (${table.succeededAt} IS NOT NULL) AND (${table.state} = 'exhausted') = (${table.exhaustedAt} IS NOT NULL) AND (${table.state} = 'canceled') = (${table.canceledAt} IS NOT NULL)`
    ),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        integrationConnectionTable.organizationId,
        integrationConnectionTable.id,
      ],
      name: "integration_delivery_organization_connection_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.routeId],
      foreignColumns: [
        integrationRouteTable.organizationId,
        integrationRouteTable.id,
      ],
      name: "integration_delivery_organization_route_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.eventId],
      foreignColumns: [
        integrationEventTable.organizationId,
        integrationEventTable.id,
      ],
      name: "integration_delivery_organization_event_fkey",
    }).onDelete("cascade"),
    uniqueIndex("integration_delivery_route_event_action_uidx").on(
      table.routeId,
      table.eventId,
      table.actionKey
    ),
    index("integration_delivery_lease_claim_idx").on(
      table.state,
      table.nextAttemptAt,
      table.leaseExpiresAt
    ),
    index("integration_delivery_connection_state_idx").on(
      table.connectionId,
      table.state
    ),
    index("integration_delivery_organization_state_idx").on(
      table.organizationId,
      table.state
    ),
    index("integration_delivery_retention_expires_at_idx").on(
      table.retentionExpiresAt
    ),
  ]
);

/** Safe append-only diagnostics for every execution attempt of a delivery. */
export const integrationDeliveryAttemptTable = pgTable(
  "integration_delivery_attempt",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id")
      .notNull()
      .references(() => integrationDeliveryTable.id, { onDelete: "cascade" }),
    attemptNumber: integer("attempt_number").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    durationMs: integer("duration_ms"),
    httpStatus: integer("http_status"),
    errorTag: text("error_tag"),
    retryDecision:
      text("retry_decision").$type<TIntegrationDeliveryRetryDecision>(),
    diagnostics:
      jsonb("diagnostics").$type<TIntegrationDeliveryAttemptDiagnostics>(),
    retentionExpiresAt: timestamp("retention_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    check(
      "integration_delivery_attempt_number_check",
      sql`${table.attemptNumber} > 0`
    ),
    check(
      "integration_delivery_attempt_duration_check",
      sql`${table.durationMs} IS NULL OR ${table.durationMs} >= 0`
    ),
    check(
      "integration_delivery_attempt_http_status_check",
      sql`${table.httpStatus} IS NULL OR ${table.httpStatus} BETWEEN 100 AND 599`
    ),
    uniqueIndex("integration_delivery_attempt_delivery_number_uidx").on(
      table.deliveryId,
      table.attemptNumber
    ),
    index("integration_delivery_attempt_delivery_started_idx").on(
      table.deliveryId,
      table.startedAt
    ),
    index("integration_delivery_attempt_retention_expires_at_idx").on(
      table.retentionExpiresAt
    ),
  ]
);

/** One provider-owned resource which can be linked to many Feeblo posts. */
export const integrationExternalResourceTable = pgTable(
  "integration_external_resource",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnectionTable.id, { onDelete: "cascade" }),
    resourceType: text("resource_type")
      .$type<TIntegrationExternalResourceType>()
      .notNull(),
    remoteId: text("remote_id").notNull(),
    remoteUrl: text("remote_url").notNull(),
    displayKey: text("display_key"),
    title: text("title"),
    stateKey: text("state_key"),
    safeMetadata: jsonb("safe_metadata")
      .$type<TIntegrationSafeDisplayMetadata>()
      .notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("integration_external_resource_organization_id_uidx").on(
      table.organizationId,
      table.id
    ),
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        integrationConnectionTable.organizationId,
        integrationConnectionTable.id,
      ],
      name: "integration_external_resource_organization_connection_fkey",
    }).onDelete("cascade"),
    uniqueIndex("integration_external_resource_connection_type_remote_uidx").on(
      table.connectionId,
      table.resourceType,
      table.remoteId
    ),
    index("integration_external_resource_organization_connection_idx").on(
      table.organizationId,
      table.connectionId
    ),
  ]
);

/** A normalized many-to-many link from a Feeblo post to an external resource. */
export const postExternalResourceLinkTable = pgTable(
  "post_external_resource_link",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    externalResourceId: text("external_resource_id")
      .notNull()
      .references(() => integrationExternalResourceTable.id, {
        onDelete: "cascade",
      }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("post_external_resource_link_organization_id_uidx").on(
      table.organizationId,
      table.id
    ),
    foreignKey({
      columns: [table.postId, table.organizationId],
      foreignColumns: [postTable.id, postTable.organizationId],
      name: "post_external_resource_link_post_organization_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.externalResourceId],
      foreignColumns: [
        integrationExternalResourceTable.organizationId,
        integrationExternalResourceTable.id,
      ],
      name: "post_external_resource_link_organization_resource_fkey",
    }).onDelete("cascade"),
    uniqueIndex("post_external_resource_link_post_resource_uidx").on(
      table.postId,
      table.externalResourceId
    ),
    index("post_external_resource_link_organization_post_idx").on(
      table.organizationId,
      table.postId
    ),
  ]
);

/** Organization-owned rule that maps aggregate linked GitHub issue state to a Feeblo status. */
export const githubSyncRuleTable = pgTable(
  "github_sync_rule",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnectionTable.id, { onDelete: "cascade" }),
    issueMatchMode: text("issue_match_mode")
      .$type<TGitHubIssueMatchMode>()
      .notNull(),
    issueState: text("issue_state").$type<TGitHubIssueState>().notNull(),
    postStatusId: text("post_status_id")
      .notNull()
      .references(() => postStatusTable.id, { onDelete: "cascade" }),
    upvoterNotificationPolicy: text("upvoter_notification_policy")
      .$type<TGitHubUpvoterNotificationPolicy>()
      .notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        integrationConnectionTable.organizationId,
        integrationConnectionTable.id,
      ],
      name: "github_sync_rule_organization_connection_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.postStatusId],
      foreignColumns: [postStatusTable.organizationId, postStatusTable.id],
      name: "github_sync_rule_organization_status_fkey",
    }).onDelete("cascade"),
    index("github_sync_rule_connection_enabled_idx").on(
      table.connectionId,
      table.enabled
    ),
    index("github_sync_rule_organization_idx").on(table.organizationId),
  ]
);

/** Durable inbox record preventing a redelivered GitHub webhook from applying twice. */
export const githubWebhookDeliveryTable = pgTable(
  "github_webhook_delivery",
  {
    id: text("id").primaryKey(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnectionTable.id, { onDelete: "cascade" }),
    deliveryId: text("delivery_id").notNull(),
    eventName: text("event_name").notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_webhook_delivery_connection_delivery_uidx").on(
      table.connectionId,
      table.deliveryId
    ),
  ]
);

/** Idempotency reservation for one user-requested external-resource creation; external I/O occurs after pending is committed. */
export const externalResourceCreateRequestTable = pgTable(
  "external_resource_create_request",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => integrationConnectionTable.id, { onDelete: "cascade" }),
    postId: text("post_id")
      .notNull()
      .references(() => postTable.id, { onDelete: "cascade" }),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").$type<TExternalResourceCreateRequestState>().notNull(),
    externalResourceId: text("external_resource_id").references(
      () => integrationExternalResourceTable.id,
      { onDelete: "set null" }
    ),
    postExternalResourceLinkId: text(
      "post_external_resource_link_id"
    ).references(() => postExternalResourceLinkTable.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.organizationId, table.connectionId],
      foreignColumns: [
        integrationConnectionTable.organizationId,
        integrationConnectionTable.id,
      ],
      name: "external_resource_create_request_organization_connection_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.postId, table.organizationId],
      foreignColumns: [postTable.id, postTable.organizationId],
      name: "external_resource_create_request_post_organization_fkey",
    }).onDelete("cascade"),
    foreignKey({
      columns: [table.organizationId, table.externalResourceId],
      foreignColumns: [
        integrationExternalResourceTable.organizationId,
        integrationExternalResourceTable.id,
      ],
      name: "external_resource_create_request_organization_resource_fkey",
    }),
    foreignKey({
      columns: [table.organizationId, table.postExternalResourceLinkId],
      foreignColumns: [
        postExternalResourceLinkTable.organizationId,
        postExternalResourceLinkTable.id,
      ],
      name: "external_resource_create_request_organization_link_fkey",
    }),
    uniqueIndex("external_resource_create_request_connection_key_uidx").on(
      table.connectionId,
      table.idempotencyKey
    ),
  ]
);

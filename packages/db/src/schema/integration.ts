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
  TIntegrationCapabilityKey,
  TIntegrationConnectionLifecycleStatus,
  TIntegrationDeliveryAttemptDiagnostics,
  TIntegrationDeliveryLastError,
  TIntegrationDeliveryRetryDecision,
  TIntegrationDeliveryState,
  TIntegrationEventType,
  TIntegrationProviderConfiguration,
  TIntegrationProviderKey,
  TIntegrationRouteEventSelection,
  TIntegrationSafeDisplayMetadata,
  TStoredIntegrationEventOrigin,
  TStoredIntegrationEventPayload,
} from "../validation-schema/integration";
import { organizationTable } from "./auth";

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
    // One route per (connection, capability, channel). Inbound capabilities
    // (commands, message.action) store no channelId and collapse to an empty
    // string, so a duplicate capability insert conflicts; each
    // channel.notifications channel keeps its own row via its channelId.
    uniqueIndex("integration_route_connection_capability_channel_uidx").on(
      table.connectionId,
      table.capabilityKey,
      sql`COALESCE(${table.providerConfig}->>'channelId', '')`
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

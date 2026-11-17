import type {
  TAuditAction,
  TAuditActorType,
  TAuditChanges,
  TAuditLogSource,
  TAuditMetadata,
  TAuditOutcome,
  TAuditResourceType,
} from "@feeblo/domain-contracts/audit";
import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/**
 * The workspace audit log: append-only entries describing what a member, an
 * API key or the product itself did to a workspace.
 *
 * End-user activity is not here — votes, comments and portal reads already
 * live in `post_activity`, which is about one post's timeline. This table is
 * about authority: which credential changed what, and which request was
 * refused. Three invariants are enforced as check constraints rather than
 * left to the writer, because a migration backfill or an operator's script
 * cannot be type-checked:
 *
 * - `resource_type` is derived from the action, so the two cannot disagree;
 * - a denial carries a reason, and only a denial carries one;
 * - an entry names an actor: a credential, a user, or `system`.
 *
 * `occurred_at` is when the action happened and `recorded_at` is when the row
 * was written. Inside a transaction the two are the same instant, which is the
 * honest answer; they diverge only if a writer ever batches, and the reader
 * needs `occurred_at` either way.
 */
export const auditLogTable = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey(),
    /**
     * The workspace the entry belongs to. Deliberately not a foreign key.
     *
     * A cascade would collide with the append-only trigger below: deleting the
     * organization deletes its entries, and that `DELETE` is exactly what the
     * trigger refuses. Workspace deletion happens in the auth layer, inside
     * better-auth's own transaction, so the audit module cannot join it to set
     * the retention GUC. An entry therefore outlives the workspace it
     * describes — which is what evidence should do — and the retention sweep is
     * the only thing that removes it. Every read is scoped by the caller's
     * organization, so an orphan is unreachable by any tenant.
     */
    organizationId: text("organization_id").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    // No foreign keys on the actor: a deleted user or a revoked key must leave
    // the entry intact, and the label is frozen for exactly that reason.
    actorType: text("actor_type").$type<TAuditActorType>().notNull(),
    actorUserId: text("actor_user_id"),
    /** The API key or OAuth client id that performed the action. */
    actorTokenId: text("actor_token_id"),
    /** The credential's name at the time of the action. */
    actorLabel: text("actor_label"),
    /** The role held at the time, so a later demotion cannot rewrite history. */
    actorRole: text("actor_role"),
    /** The member a member-management action acted on. */
    affectedUserId: text("affected_user_id"),
    source: text("source").$type<TAuditLogSource>().notNull(),
    action: text("action").$type<TAuditAction>().notNull(),
    outcome: text("outcome").$type<TAuditOutcome>().notNull(),
    denialReason: text("denial_reason"),
    resourceType: text("resource_type").$type<TAuditResourceType>().notNull(),
    /** A Legid, so it is already the public form the API returns. */
    resourceId: text("resource_id"),
    changes: jsonb("changes").$type<TAuditChanges>(),
    metadata: jsonb("metadata").$type<TAuditMetadata>(),
    requestId: text("request_id"),
    originIp: text("origin_ip"),
    originCountry: text("origin_country"),
    userAgent: text("user_agent"),
  },
  (table) => [
    // The listing, and the keyset predicate `(occurred_at, id) < (…, …)`.
    index("audit_log_org_occurredAt_idx").on(
      table.organizationId,
      table.occurredAt.desc(),
      table.id.desc()
    ),
    index("audit_log_org_action_idx").on(
      table.organizationId,
      table.action,
      table.occurredAt.desc()
    ),
    index("audit_log_org_resource_idx").on(
      table.organizationId,
      table.resourceType,
      table.occurredAt.desc()
    ),
    index("audit_log_org_actor_idx").on(
      table.organizationId,
      table.actorUserId,
      table.occurredAt.desc()
    ),
    // "Did this update touch `status`?" — membership in `changes.fields`.
    index("audit_log_changedFields_idx").using(
      "gin",
      sql`(${table.changes} -> 'fields')`
    ),
    // Denials are what an operator reads first, and the index stays small.
    index("audit_log_denied_idx")
      .on(table.organizationId, table.occurredAt.desc())
      .where(sql`${table.outcome} = 'denied'`),
    // The retention sweep deletes across workspaces, so it cannot use a
    // workspace-leading index.
    index("audit_log_occurredAt_idx").on(table.occurredAt),

    check(
      "audit_log_resourceType_derived_chk",
      sql`${table.resourceType} = split_part(${table.action}, '.', 1)`
    ),
    check(
      "audit_log_denial_reason_chk",
      sql`(${table.outcome} = 'allowed' and ${table.denialReason} is null) or (${table.outcome} = 'denied' and ${table.denialReason} is not null)`
    ),
    check(
      "audit_log_actor_chk",
      sql`${table.actorType} = 'system' or ${table.actorUserId} is not null or ${table.actorTokenId} is not null`
    ),
    check(
      "audit_log_actor_role_chk",
      sql`${table.actorRole} is null or ${table.actorType} = 'user' or ${table.actorType} = 'oauth_client'`
    ),
  ]
);

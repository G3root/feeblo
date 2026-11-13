import {
  AuditActionSchema,
  AuditActorType,
  AuditChanges,
  AuditLogSource,
  AuditMetadata,
  AuditOutcome,
  AuditResourceTypeSchema,
} from "@feeblo/domain-contracts/audit";
import { AuditLogId, WorkspaceId } from "@feeblo/id";
import * as Schema from "effect/Schema";

/**
 * The audit log's wire contract.
 *
 * Two schemas describe the same row: `AuditLogStoredEntry` decodes what the
 * repository reads back (dates arrive as `Date`), and `AuditLogEntry` is what
 * the RPC returns (dates encode to ISO strings on the wire, as every other
 * dashboard contract here does). Their types are identical, so the handler
 * only adds the labels.
 */

const EntryFields = {
  id: AuditLogId.schema,
  actorType: AuditActorType,
  actorUserId: Schema.NullOr(Schema.String),
  actorTokenId: Schema.NullOr(Schema.String),
  actorLabel: Schema.NullOr(Schema.String),
  actorRole: Schema.NullOr(Schema.String),
  affectedUserId: Schema.NullOr(Schema.String),
  source: AuditLogSource,
  action: Schema.String,
  outcome: AuditOutcome,
  denialReason: Schema.NullOr(Schema.String),
  resourceType: Schema.String,
  resourceId: Schema.NullOr(Schema.String),
  changes: Schema.NullOr(AuditChanges),
  metadata: Schema.NullOr(AuditMetadata),
  requestId: Schema.NullOr(Schema.String),
  originIp: Schema.NullOr(Schema.String),
  originCountry: Schema.NullOr(Schema.String),
  userAgent: Schema.NullOr(Schema.String),
} as const;

/** One stored entry, exactly as the repository reads it. */
export const AuditLogStoredEntry = Schema.Struct({
  ...EntryFields,
  occurredAt: Schema.Date,
  recordedAt: Schema.Date,
});
export type TAuditLogStoredEntry = Schema.Schema.Type<
  typeof AuditLogStoredEntry
>;

/** One entry as the dashboard reads it, with the labels this build knows. */
export const AuditLogEntry = Schema.Struct({
  ...EntryFields,
  /** Null for an action recorded by a build that declared a verb this one does not. */
  actionLabel: Schema.NullOr(Schema.String),
  resourceLabel: Schema.NullOr(Schema.String),
  occurredAt: Schema.DateFromString,
  recordedAt: Schema.DateFromString,
});
export type TAuditLogEntry = Schema.Schema.Type<typeof AuditLogEntry>;

/**
 * Where a page starts: the sort key of the last entry the caller already has.
 *
 * Keyset, not an offset. The table is append-only, so rows arrive between
 * pages; an offset would shift the window and silently repeat or skip entries.
 */
export const AuditLogCursor = Schema.Struct({
  id: Schema.String,
  occurredAt: Schema.Date,
});
export type TAuditLogCursor = Schema.Schema.Type<typeof AuditLogCursor>;

/** Which part of the log a listing covers. Absent lists both. */
export const AuditLogKind = Schema.Literals(["changes", "access"]);
export type TAuditLogKind = Schema.Schema.Type<typeof AuditLogKind>;

export const AuditLogListRequest = Schema.Struct({
  organizationId: WorkspaceId.schema,
  limit: Schema.Int.pipe(
    Schema.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
  ),
  /** Continue after this entry; absent starts at the newest. */
  after: Schema.optionalKey(AuditLogCursor),
  /**
   * `changes` leaves out data access unless it was denied, `access` returns
   * only data access, absent returns both.
   */
  kind: Schema.optionalKey(AuditLogKind),
  action: Schema.optionalKey(AuditActionSchema),
  resourceType: Schema.optionalKey(AuditResourceTypeSchema),
  resourceId: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))
  ),
  /** The actor's user id, for a person; credentials are found by `action`. */
  actorUserId: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(64)))
  ),
  outcome: Schema.optionalKey(AuditOutcome),
  /** Only entries whose diff touched this field name. */
  changedField: Schema.optionalKey(
    Schema.String.pipe(Schema.check(Schema.isMaxLength(100)))
  ),
  since: Schema.optionalKey(Schema.Date),
  until: Schema.optionalKey(Schema.Date),
});
export type TAuditLogListRequest = Schema.Schema.Type<
  typeof AuditLogListRequest
>;

export const AuditLogPage = Schema.Struct({
  items: Schema.Array(AuditLogEntry),
  /** The cursor for the next page, or null on the last one. */
  next: Schema.NullOr(AuditLogCursor),
});
export type TAuditLogPage = Schema.Schema.Type<typeof AuditLogPage>;

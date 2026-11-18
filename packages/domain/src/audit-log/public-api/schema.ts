import {
  AuditActionSchema,
  AuditActorType,
  AuditLogSource,
  AuditOutcome,
} from "@feeblo/domain-contracts/audit";
import * as Schema from "effect/Schema";

import { PUBLIC_API_PAGE_MAX_LIMIT } from "../../public-api/common";

/**
 * The audit log's Public API resource.
 *
 * Hand-written rather than a projection of `audit-log/schema.ts`: that module is
 * the dashboard's RPC contract, and its entry carries `originIp`, `userAgent`
 * and `requestId`, which are administrator forensics rather than data a key
 * should be able to export. Declaring the payload here means a column added to
 * the dashboard's read appears in this contract only when the DTO and its
 * mapper are edited too. See `docs/adr/0004`.
 *
 * What remains is the accountability record itself: what happened, to which
 * resource, by whom, and — for a change — the before/after diff the writer
 * captured.
 */

/**
 * The two halves of the log, as the reader splits them.
 *
 * Declared here rather than imported from the dashboard contract for the same
 * reason as the entry: it is part of the published request vocabulary.
 * `changes` leaves out data access unless it was denied, `access` returns only
 * data access, and an absent `kind` returns both.
 */
export const AUDIT_LOG_KINDS = ["changes", "access"] as const;

export const PublicApiAuditLogKind = Schema.Literals(AUDIT_LOG_KINDS);

export type TPublicApiAuditLogKind = Schema.Schema.Type<
  typeof PublicApiAuditLogKind
>;

/**
 * The strict before/after diff of an update.
 *
 * `fields` is authoritative: `after` omits a field the action cleared rather
 * than spelling it `undefined`, and a value missing from both maps was not
 * captured. The values are left as the row stores them — the writer owns what
 * each action may put in a diff, and the reader treats them as opaque.
 */
export const PublicApiAuditLogChanges = Schema.Struct({
  fields: Schema.Array(Schema.String),
  before: Schema.Record(Schema.String, Schema.Unknown),
  after: Schema.Record(Schema.String, Schema.Unknown),
});

export type TPublicApiAuditLogChanges = Schema.Schema.Type<
  typeof PublicApiAuditLogChanges
>;

/**
 * Action-specific context: the endpoint and status of an audited read, the
 * subject of a member action, a refused scope. Not a diff, and opaque to the
 * reader — each action documents the keys it writes.
 */
export const PublicApiAuditLogMetadata = Schema.Record(
  Schema.String,
  Schema.Unknown
);

export type TPublicApiAuditLogMetadata = Schema.Schema.Type<
  typeof PublicApiAuditLogMetadata
>;

/**
 * One entry of the workspace's audit log.
 *
 * `actionLabel` comes from the build that answered, so a client built before a
 * new verb still shows a label; an action this build does not know reads as
 * `null` rather than failing the page.
 *
 * `actorId` is the acting credential when there is one (an API key or OAuth
 * client id) and the person behind a dashboard session otherwise. `actorLabel`
 * is the credential's name frozen at write time — a member's name is resolved
 * from the member directory when the dashboard reads the log, never stored on
 * the entry, so it is absent for a person. `originIp`, `userAgent` and
 * `requestId` are deliberately not fields: an audit export is not a request
 * log.
 */
export const PublicApiAuditLogEntry = Schema.Struct({
  id: Schema.String,
  action: Schema.String,
  actionLabel: Schema.NullOr(Schema.String),
  outcome: AuditOutcome,
  denialReason: Schema.NullOr(Schema.String),
  actorType: AuditActorType,
  actorId: Schema.NullOr(Schema.String),
  actorLabel: Schema.NullOr(Schema.String),
  source: AuditLogSource,
  resourceType: Schema.String,
  resourceId: Schema.NullOr(Schema.String),
  changes: Schema.NullOr(PublicApiAuditLogChanges),
  metadata: Schema.NullOr(PublicApiAuditLogMetadata),
  occurredAt: Schema.DateFromString,
});

export type TPublicApiAuditLogEntry = Schema.Schema.Type<
  typeof PublicApiAuditLogEntry
>;

/**
 * The page envelope every paginated endpoint uses.
 *
 * The cursor is opaque and is keyed on `(occurredAt, id)` here rather than on
 * the shared `(createdAt, id)` tuple, because the log is ordered by when the
 * action happened and its rows are append-only — see `./operations.ts`.
 */
export const PublicApiAuditLogPage = Schema.Struct({
  data: Schema.Array(PublicApiAuditLogEntry),
  nextCursor: Schema.NullOr(Schema.String),
});

export type TPublicApiAuditLogPage = Schema.Schema.Type<
  typeof PublicApiAuditLogPage
>;

/** Query parameters, declared as strings and validated in the handler. */
export const ListAuditLogEntriesQuery = Schema.Struct({
  limit: Schema.optional(Schema.String),
  cursor: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.String),
  action: Schema.optional(Schema.String),
  outcome: Schema.optional(Schema.String),
  actorType: Schema.optional(Schema.String),
  since: Schema.optional(Schema.String),
  until: Schema.optional(Schema.String),
});

/**
 * Typed input for a page of the workspace's audit log.
 *
 * `action`, `outcome`, `actorType` and `kind` are closed vocabularies, so an
 * unknown value is rejected rather than answered as a silently empty page: a
 * typo in a sync's action filter should not read as "nothing happened".
 *
 * `since` and `until` are strings rather than a decoded date for the same
 * reason the post list's `updatedAfter` is: the operation validates the ISO
 * shape and the calendar itself, so the HTTP query parameter and the MCP tool
 * argument are checked by one piece of code and neither surface can accept a
 * day that does not exist.
 */
export const ListAuditLogEntriesInput = Schema.Struct({
  cursor: Schema.optional(
    Schema.String.annotate({ description: "Opaque page cursor" })
  ),
  limit: Schema.optional(
    Schema.Finite.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),
      Schema.isLessThanOrEqualTo(PUBLIC_API_PAGE_MAX_LIMIT)
    ).annotate({
      description: "Page size, 1–100",
    })
  ),
  kind: Schema.optional(PublicApiAuditLogKind).annotate({
    description:
      "changes omits data access unless it was denied; access returns only data access; absent returns both",
  }),
  action: Schema.optional(AuditActionSchema).annotate({
    description: "Only entries for this audit action",
  }),
  outcome: Schema.optional(AuditOutcome).annotate({
    description:
      "Only entries that were allowed, or only those that were denied",
  }),
  actorType: Schema.optional(AuditActorType).annotate({
    description: "Only entries by this kind of actor",
  }),
  since: Schema.optional(Schema.String).annotate({
    description: "Only entries that occurred at or after this ISO 8601 instant",
  }),
  until: Schema.optional(Schema.String).annotate({
    description:
      "Only entries that occurred at or before this ISO 8601 instant",
  }),
});

export type TListAuditLogEntriesInput = Schema.Schema.Type<
  typeof ListAuditLogEntriesInput
>;

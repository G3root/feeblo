import {
  type TAuditActorType,
  type TAuditChanges,
  type TAuditLogSource,
  type TAuditMetadata,
  type TAuditOutcome,
  auditActionLabel,
} from "@feeblo/domain-contracts/audit";

import type { TPublicApiAuditLogEntry } from "./schema";

/**
 * What an audit-log mapper is allowed to read.
 *
 * Declared structurally and narrowly, like every other public mapper: the stored
 * entry also carries `recordedAt`, the request forensics (`requestId`,
 * `originIp`, `originCountry`, `userAgent`) and the actor's role and affected
 * subject, and a mapper that could accept the repository row could pass one of
 * them through. `toAuditLogSource` is the only bridge from that row to this
 * type, so a column added to the table cannot reach a public response without
 * being added here first.
 *
 * The shape is written out rather than taken from the stored-entry type in
 * `../schema.ts`, because that module is the dashboard's contract and a public
 * surface is forbidden from importing it (`oxlint.config.ts`). The
 * repository row is assignable to what the mapper names, and a field it gains
 * is invisible here until it is added below.
 */
export type PublicApiAuditLogSource = {
  readonly id: string;
  readonly action: string;
  readonly outcome: TAuditOutcome;
  readonly denialReason: string | null;
  readonly actorType: TAuditActorType;
  readonly actorUserId: string | null;
  readonly actorTokenId: string | null;
  readonly actorLabel: string | null;
  readonly source: TAuditLogSource;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly changes: TAuditChanges | null;
  readonly metadata: TAuditMetadata | null;
  readonly occurredAt: Date;
};

/** Narrows a stored entry to the fields a public response may name. */
export const toAuditLogSource = (row: {
  readonly id: string;
  readonly action: string;
  readonly outcome: TAuditOutcome;
  readonly denialReason: string | null;
  readonly actorType: TAuditActorType;
  readonly actorUserId: string | null;
  readonly actorTokenId: string | null;
  readonly actorLabel: string | null;
  readonly source: TAuditLogSource;
  readonly resourceType: string;
  readonly resourceId: string | null;
  readonly changes: TAuditChanges | null;
  readonly metadata: TAuditMetadata | null;
  readonly occurredAt: Date;
}): PublicApiAuditLogSource => ({
  action: row.action,
  actorLabel: row.actorLabel,
  actorTokenId: row.actorTokenId,
  actorType: row.actorType,
  actorUserId: row.actorUserId,
  changes: row.changes,
  denialReason: row.denialReason,
  id: row.id,
  metadata: row.metadata,
  occurredAt: row.occurredAt,
  outcome: row.outcome,
  resourceId: row.resourceId,
  resourceType: row.resourceType,
  source: row.source,
});

/**
 * The acting identity, as one id.
 *
 * A credential is what acted when there is one — an OAuth grant also carries
 * the member behind it, but the client is who made the request — and a
 * dashboard session is named by its user otherwise. A `system` entry names
 * nobody, which is the honest answer for a sweep.
 */
const actorIdOf = (entry: PublicApiAuditLogSource): string | null =>
  entry.actorTokenId ?? entry.actorUserId;

/**
 * Metadata keys this surface withholds.
 *
 * Every other part of an entry is a named column the DTO chooses, but
 * `metadata` is a record whose keys the writer chooses, so it is the one part
 * that can carry something the contract refuses. A contact's create and update
 * entries record the address a member typed, because the dashboard's log names
 * the person an entry is about; a key takes an email as a lookup key and never
 * receives one (`docs/public-api.md`, "Data exposure"). Dropping the key here,
 * at the one place a stored row becomes a response, keeps the stored entry
 * whole for the dashboard and the promise at the boundary that makes it.
 */
const WITHHELD_METADATA_KEYS: ReadonlySet<string> = new Set(["email"]);

const toPublicApiMetadata = (
  metadata: TAuditMetadata | null
): TAuditMetadata | null => {
  if (metadata === null) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !WITHHELD_METADATA_KEYS.has(key))
  );
};

/** One entry as the audit-log endpoint returns it. */
export const toPublicApiAuditLogEntry = (
  entry: PublicApiAuditLogSource
): TPublicApiAuditLogEntry => ({
  action: entry.action,
  actionLabel: auditActionLabel(entry.action),
  actorId: actorIdOf(entry),
  actorLabel: entry.actorLabel,
  actorType: entry.actorType,
  changes: entry.changes,
  denialReason: entry.denialReason,
  id: entry.id,
  metadata: toPublicApiMetadata(entry.metadata),
  occurredAt: entry.occurredAt,
  outcome: entry.outcome,
  resourceId: entry.resourceId,
  resourceType: entry.resourceType,
  source: entry.source,
});

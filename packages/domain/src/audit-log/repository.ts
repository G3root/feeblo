import { currentDb, schema } from "@feeblo/db";
import type {
  TAuditActorType,
  TAuditChanges,
  TAuditLogSource,
  TAuditMetadata,
  TAuditOutcome,
  TAuditResourceType,
} from "@feeblo/domain-contracts/audit";
import {
  AUDIT_ACCESS_ACTIONS,
  type TAuditAction,
} from "@feeblo/domain-contracts/audit";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

import { AuditLogDataError } from "./errors";
import {
  AuditLogStoredEntry,
  type TAuditLogCursor,
  type TAuditLogKind,
} from "./schema";

/** One row as the recorder writes it: every optional column already lowered. */
export interface TAuditLogInsert {
  readonly id: string;
  readonly organizationId: string;
  readonly occurredAt: Date;
  readonly actorType: TAuditActorType;
  readonly actorUserId: string | null;
  readonly actorTokenId: string | null;
  readonly actorLabel: string | null;
  readonly actorRole: string | null;
  readonly affectedUserId: string | null;
  readonly source: TAuditLogSource;
  readonly action: TAuditAction;
  readonly outcome: TAuditOutcome;
  readonly denialReason: string | null;
  readonly resourceType: TAuditResourceType;
  readonly resourceId: string | null;
  readonly changes: TAuditChanges | null;
  readonly metadata: TAuditMetadata | null;
  readonly requestId: string | null;
  readonly originIp: string | null;
  readonly originCountry: string | null;
  readonly userAgent: string | null;
}

export interface TAuditLogPageQuery {
  readonly organizationId: string;
  readonly limit: number;
  readonly after?: TAuditLogCursor | undefined;
  readonly kind?: TAuditLogKind | undefined;
  readonly action?: TAuditAction | undefined;
  readonly resourceType?: TAuditResourceType | undefined;
  readonly resourceId?: string | undefined;
  readonly actorUserId?: string | undefined;
  readonly outcome?: TAuditOutcome | undefined;
  readonly changedField?: string | undefined;
  readonly since?: Date | undefined;
  readonly until?: Date | undefined;
}

const table = schema.auditLogTable;

const dataError = (operation: string, reason: string, cause?: unknown) =>
  new AuditLogDataError({
    ...(cause === undefined ? undefined : { cause }),
    operation,
    reason,
  });

/**
 * The two halves of the log, as a predicate.
 *
 * `changes` keeps a refused access entry: a denial is a change in the
 * workspace's security posture even when the action it refused was a read, and
 * excluding it would hide exactly the rows an operator is looking for.
 */
const kindCondition = (kind: TAuditLogKind | undefined): SQL | undefined => {
  if (kind === undefined) {
    return undefined;
  }
  const access = inArray(table.action, [...AUDIT_ACCESS_ACTIONS]);
  if (kind === "access") {
    return access;
  }
  const deniedAccess = and(access, eq(table.outcome, "denied"));
  return or(deniedAccess, notInArray(table.action, [...AUDIT_ACCESS_ACTIONS]));
};

const makeAuditLogRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  /**
   * Appends one entry.
   *
   * The insert is deliberately not wrapped in a retry or a swallow: a caller
   * inside `transaction()` needs the failure to abort the transaction, and a
   * caller outside one decides for itself. `record` and `recordBestEffort` in
   * the recorder are those two decisions.
   */
  const insert = Effect.fn("AuditLogRepository.insert")(function* (
    row: TAuditLogInsert
  ) {
    yield* db.insert(table).values(row);
  });

  /**
   * One page, newest first, plus the cursor of the page after it.
   *
   * Keyset on `(occurred_at, id)`: the table only grows at the top, so a page
   * read after a new entry arrived still continues from the same place, where
   * an offset would shift and repeat a row.
   */
  const findPage = Effect.fn("AuditLogRepository.findPage")(function* (
    query: TAuditLogPageQuery
  ) {
    const after = query.after;
    const changedField = query.changedField;
    const rows = yield* db
      .select({
        id: table.id,
        occurredAt: table.occurredAt,
        recordedAt: table.recordedAt,
        actorType: table.actorType,
        actorUserId: table.actorUserId,
        actorTokenId: table.actorTokenId,
        actorLabel: table.actorLabel,
        actorRole: table.actorRole,
        affectedUserId: table.affectedUserId,
        source: table.source,
        action: table.action,
        outcome: table.outcome,
        denialReason: table.denialReason,
        resourceType: table.resourceType,
        resourceId: table.resourceId,
        changes: table.changes,
        metadata: table.metadata,
        requestId: table.requestId,
        originIp: table.originIp,
        originCountry: table.originCountry,
        userAgent: table.userAgent,
      })
      .from(table)
      .where(
        and(
          eq(table.organizationId, query.organizationId),
          after === undefined
            ? undefined
            : sql`(${table.occurredAt}, ${table.id}) < (${after.occurredAt}, ${after.id})`,
          query.action === undefined
            ? undefined
            : eq(table.action, query.action),
          query.resourceType === undefined
            ? undefined
            : eq(table.resourceType, query.resourceType),
          query.resourceId === undefined
            ? undefined
            : eq(table.resourceId, query.resourceId),
          query.actorUserId === undefined
            ? undefined
            : eq(table.actorUserId, query.actorUserId),
          query.outcome === undefined
            ? undefined
            : eq(table.outcome, query.outcome),
          changedField === undefined
            ? undefined
            : sql`(${table.changes} -> 'fields') @> jsonb_build_array(${changedField}::text)`,
          query.since === undefined
            ? undefined
            : gte(table.occurredAt, query.since),
          query.until === undefined
            ? undefined
            : lte(table.occurredAt, query.until),
          kindCondition(query.kind)
        )
      )
      .orderBy(desc(table.occurredAt), desc(table.id))
      // One row past the page answers `has more` without a second count.
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = yield* Effect.forEach(page, (row) =>
      Schema.decodeEffect(AuditLogStoredEntry)(row).pipe(
        Effect.mapError(() =>
          dataError("list", "Stored audit entry is invalid")
        )
      )
    );
    const last = items.at(-1);
    return {
      items,
      next:
        hasMore && last !== undefined
          ? { id: last.id, occurredAt: last.occurredAt }
          : null,
    };
  });

  return { findPage, insert };
});

export class AuditLogRepository extends Context.Service<AuditLogRepository>()(
  "AuditLogRepository",
  { make: makeAuditLogRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}

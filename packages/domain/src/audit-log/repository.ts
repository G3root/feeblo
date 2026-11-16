import { currentDb, schema, transaction } from "@feeblo/db";
import type {
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

/**
 * One row as the recorder writes it.
 *
 * Derived from the table rather than restated, so a column added to
 * `audit_log` is a compile error at the recorder instead of a column silently
 * taking its default. `Required` keeps the explicit-null contract — the
 * recorder lowers every absent value to `null` rather than omitting the key —
 * and `recorded_at` is the one column the database stamps, so it is the one
 * key left out.
 */
export type TAuditLogInsert = Omit<
  Required<typeof schema.auditLogTable.$inferInsert>,
  "recordedAt"
>;

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

/**
 * The transaction-local setting the append-only trigger reads.
 *
 * The migration raises on `UPDATE` and `DELETE` unless this is `on`, so the
 * retention sweep is the only writer that can remove a row and it says so on
 * its own transaction. A `SET LOCAL` outside a transaction is a no-op, which is
 * why the sweep runs inside `transaction()` rather than as a bare statement.
 */
export const AUDIT_LOG_RETENTION_SETTING = "feeblo.audit_retention";

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

  /**
   * Removes one batch of entries older than `cutoff`, and answers how many it
   * removed.
   *
   * Batched through `ctid` because `DELETE … LIMIT` is not Postgres: the
   * subquery picks the oldest rows, the delete touches only those, and the
   * caller repeats while a full batch comes back. Each batch is its own short
   * transaction, so a sweep never holds a lock long enough to block a writer.
   */
  const deleteBefore = Effect.fn("AuditLogRepository.deleteBefore")(function* (
    cutoff: Date,
    batchSize: number
  ) {
    return yield* transaction(
      Effect.gen(function* () {
        const tx = yield* currentDb;
        yield* tx.execute(sql`set local feeblo.audit_retention = 'on'`);

        const deleted = yield* tx.execute(sql`
            delete from audit_log
            where ctid in (
              select ctid from audit_log
              where occurred_at < ${cutoff}
              order by occurred_at
              limit ${batchSize}
            )
          `);

        return deleted.rowCount ?? 0;
      })
    );
  });

  return { deleteBefore, findPage, insert };
});

export class AuditLogRepository extends Context.Service<AuditLogRepository>()(
  "AuditLogRepository",
  { make: makeAuditLogRepository }
) {
  static readonly layer = Layer.effect(this, this.make);
}

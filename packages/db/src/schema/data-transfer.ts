import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import type {
  TDataImportRowOutcome,
  TDataImportStatus,
  TStagedDataImportRow,
} from "../validation-schema/data-import";
import { memberTable, organizationTable, userTable } from "./auth";
import { boardTable, postTable } from "./feedback";

/**
 * One staged board CSV import and its apply progress.
 *
 * The uploaded bytes are never stored: the job records the file's name and
 * SHA-256 hash (for the duplicate-upload warning) and the parsed plan lives in
 * `data_import_row`. `retention_expires_at` is the only thing that deletes a
 * job — the worker sweeps it after the retention window, so a row report is
 * readable for a while and then gone.
 */
export const dataImportJobTable = pgTable(
  "data_import_job",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizationTable.id, { onDelete: "cascade" }),
    boardId: text("board_id")
      .notNull()
      .references(() => boardTable.id, { onDelete: "cascade" }),
    /** The member who uploaded the file; null once their account is gone. */
    createdByUserId: text("created_by_user_id").references(() => userTable.id, {
      onDelete: "set null",
    }),
    createdByMemberId: text("created_by_member_id").references(
      () => memberTable.id,
      { onDelete: "set null" }
    ),
    status: text("status").$type<TDataImportStatus>().notNull(),
    fileName: text("file_name").notNull(),
    fileHash: text("file_hash").notNull(),
    /** File-level notices shown before confirmation; never personal data. */
    notices: jsonb("notices")
      .$type<readonly string[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    /** Data rows found in the file, excluding the header. */
    rowCount: integer("row_count").notNull(),
    createdCount: integer("created_count").default(0).notNull(),
    /** Rows that became posts with a substituted or omitted value. */
    warningCount: integer("warning_count").default(0).notNull(),
    /** Rows that will never become a post, at staging or at apply time. */
    errorCount: integer("error_count").default(0).notNull(),
    /** Safe summary of a failed pass; the row table carries row failures. */
    failureMessage: text("failure_message"),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
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
      "data_import_job_counts_check",
      sql`${table.rowCount} >= 0 AND ${table.createdCount} >= 0 AND ${table.warningCount} >= 0 AND ${table.errorCount} >= 0`
    ),
    check(
      "data_import_job_lease_check",
      sql`(${table.status} = 'running') = (${table.leaseOwner} IS NOT NULL AND ${table.leaseExpiresAt} IS NOT NULL)`
    ),
    // The claim query scans for queued work and expired leases in this order.
    index("data_import_job_claim_idx").on(table.status, table.createdAt),
    // At most one job per workspace is staged, queued, or running. The
    // service's `hasActiveJob` check is the fast path; this index is what
    // makes the rule hold when two uploads race past that check.
    uniqueIndex("data_import_job_organization_active_uidx")
      .on(table.organizationId)
      .where(
        sql`${table.status} IN ('awaiting_confirmation', 'queued', 'running')`
      ),
    index("data_import_job_organization_created_idx").on(
      table.organizationId,
      table.createdAt
    ),
    // The duplicate-upload warning looks up an earlier job by the same bytes.
    index("data_import_job_organization_file_hash_idx").on(
      table.organizationId,
      table.fileHash
    ),
    index("data_import_job_retention_idx").on(table.retentionExpiresAt),
  ]
);

/**
 * One parsed row of an import, and the checkpoint that makes a resumed pass
 * safe: the worker only applies `pending` rows, so replaying a pass can never
 * create a post twice.
 *
 * `payload` is the plan the staging pass produced and the only place a row's
 * customer email rests. It is read, applied and then deleted with the job —
 * never logged, never traced, never returned by a list endpoint.
 */
export const dataImportRowTable = pgTable(
  "data_import_row",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => dataImportJobTable.id, { onDelete: "cascade" }),
    /** 1-based data row number, counting from the first row after the header. */
    rowNumber: integer("row_number").notNull(),
    outcome: text("outcome").$type<TDataImportRowOutcome>().notNull(),
    /**
     * A static, field-scoped explanation of a failed row ("The title is
     * required."). Never a value copied from the file; the row report shows
     * the row number so the uploader can look the value up themselves.
     */
    message: text("message"),
    /** The parsed plan; null for a row that failed before it had one. */
    payload: jsonb("payload").$type<TStagedDataImportRow>(),
    /** The post this row created, cleared if that post is later deleted. */
    postId: text("post_id").references(() => postTable.id, {
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
    check("data_import_row_row_number_check", sql`${table.rowNumber} > 0`),
    check(
      "data_import_row_payload_check",
      sql`${table.outcome} <> 'created' OR ${table.postId} IS NOT NULL`
    ),
    uniqueIndex("data_import_row_job_row_uidx").on(
      table.jobId,
      table.rowNumber
    ),
    // The worker scans pending rows and the report groups by outcome.
    index("data_import_row_job_outcome_row_idx").on(
      table.jobId,
      table.outcome,
      table.rowNumber
    ),
  ]
);

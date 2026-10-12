import { currentDb, schema } from "@feeblo/db";
import type {
  TDataImportRowOutcome,
  TDataImportStatus,
  TStagedDataImportRow,
} from "@feeblo/db/validation-schema/data-import";
import { StagedDataImportRow } from "@feeblo/domain-contracts/data-import";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";
import { DataImportRowId } from "@feeblo/id";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { getUniqueViolationConstraint, isUniqueViolation } from "../rpc-errors";
import {
  ACTIVE_IMPORT_MESSAGE,
  DataImportAlreadyActiveError,
  DataTransferRepositoryError,
} from "./errors";
import { DATA_IMPORT_RETENTION_MS } from "./limits";
import type { TDataImportRowFilter, TDataImportRowSort } from "./schema";

/** The active states; a job in one of these owns its workspace's transfer slot. */
const ACTIVE_STATUSES = [
  "awaiting_confirmation",
  "queued",
  "running",
] as const satisfies readonly TDataImportStatus[];

const JOB_FIELDS = {
  confirmedAt: schema.dataImportJobTable.confirmedAt,
  createdByMemberId: schema.dataImportJobTable.createdByMemberId,
  createdByUserId: schema.dataImportJobTable.createdByUserId,
  createdAt: schema.dataImportJobTable.createdAt,
  createdCount: schema.dataImportJobTable.createdCount,
  errorCount: schema.dataImportJobTable.errorCount,
  failureMessage: schema.dataImportJobTable.failureMessage,
  fileName: schema.dataImportJobTable.fileName,
  fileHash: schema.dataImportJobTable.fileHash,
  finishedAt: schema.dataImportJobTable.finishedAt,
  id: schema.dataImportJobTable.id,
  notices: schema.dataImportJobTable.notices,
  organizationId: schema.dataImportJobTable.organizationId,
  rowCount: schema.dataImportJobTable.rowCount,
  startedAt: schema.dataImportJobTable.startedAt,
  status: schema.dataImportJobTable.status,
  warningCount: schema.dataImportJobTable.warningCount,
  retentionExpiresAt: schema.dataImportJobTable.retentionExpiresAt,
} as const;

/** One staged import as the application reads it; never a raw table row. */
export type DataImportJobRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly createdByUserId: string | null;
  readonly createdByMemberId: string | null;
  readonly status: TDataImportStatus;
  readonly fileName: string;
  readonly fileHash: string;
  readonly notices: readonly string[];
  readonly rowCount: number;
  readonly createdCount: number;
  readonly warningCount: number;
  readonly errorCount: number;
  readonly failureMessage: string | null;
  readonly confirmedAt: Date | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly createdAt: Date;
  readonly retentionExpiresAt: Date;
};

/** One row as the report reads it. The payload is deliberately absent. */
export type DataImportRowRecord = {
  readonly id: string;
  readonly rowNumber: number;
  readonly outcome: TDataImportRowOutcome;
  readonly message: string | null;
  readonly postId: string | null;
  /** The planned title, so the preview can show what the row will create. */
  readonly title: string | null;
  /** The planned board name, or null for a row that never got one. */
  readonly boardName: string | null;
  /** The planned status display name; null for a row that never got one. */
  readonly statusName: string | null;
  /** A bounded excerpt of the planned body; never the whole payload. */
  readonly contentPreview: string | null;
  /**
   * The created post's slugs, read through the post and its board. Null until
   * the worker has created the post, or after that post is deleted.
   */
  readonly boardSlug: string | null;
  readonly postSlug: string | null;
  /**
   * The row's planned substitutions, bounded. Empty for a row that needs no
   * attention, and for every row that failed before it had a plan.
   */
  readonly warnings: readonly string[];
};

/** One row of the problems CSV: a failure or a row with substitutions. */
export type DataImportProblemRow = {
  readonly rowNumber: number;
  readonly outcome: TDataImportRowOutcome;
  readonly title: string | null;
  readonly boardName: string | null;
  readonly statusName: string | null;
  readonly message: string | null;
  readonly warnings: readonly string[];
};

/** Whole-job tallies and the two groupings the review page reads. */
export type DataImportReportSummary = {
  readonly counts: {
    readonly total: number;
    readonly pending: number;
    readonly created: number;
    readonly failed: number;
    readonly warned: number;
  };
  readonly failureGroups: readonly {
    readonly message: string;
    readonly count: number;
  }[];
  readonly boardGroups: readonly {
    readonly name: string;
    readonly count: number;
  }[];
};

/** One row as the worker applies it, payload included. */
export type PendingDataImportRow = {
  readonly id: string;
  readonly rowNumber: number;
  readonly payload: TStagedDataImportRow | null;
};

export type DataImportCounts = {
  readonly createdCount: number;
  readonly errorCount: number;
};

/** One post as the CSV export reads it, before the CSV layer names it. */
export type PostCsvSourceRow = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
  readonly boardName: string;
  readonly boardSlug: string;
  readonly statusLabel: string;
  readonly statusType: TPostStatusType;
  readonly etaQuarter: string | null;
  readonly tags: readonly string[];
  readonly authorName: string | null;
  readonly authorEmail: string | null;
  readonly voteCount: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export type ClaimedDataImportJob = {
  readonly job: DataImportJobRecord;
  readonly leaseOwner: string;
};

export type NewStagedImportRow = {
  readonly rowNumber: number;
  readonly outcome: TDataImportRowOutcome;
  readonly message: string | null;
  readonly payload: TStagedDataImportRow | null;
};

export interface DataTransferRepositoryContract {
  /** True when the workspace already holds a staged, queued, or running job. */
  readonly hasActiveJob: (input: {
    readonly organizationId: string;
  }) => Effect.Effect<boolean, DataTransferRepositoryError>;
  /** The most recent job that actually ran and uploaded the same bytes. */
  readonly findPriorJobByHash: (input: {
    readonly organizationId: string;
    readonly fileHash: string;
  }) => Effect.Effect<
    Option.Option<{ readonly id: string; readonly createdAt: Date }>,
    DataTransferRepositoryError
  >;
  readonly insertStagedJob: (input: {
    readonly id: string;
    readonly organizationId: string;
    readonly createdByUserId: string | null;
    readonly createdByMemberId: string | null;
    readonly fileName: string;
    readonly fileHash: string;
    readonly notices: readonly string[];
    readonly rows: readonly NewStagedImportRow[];
  }) => Effect.Effect<
    DataImportJobRecord,
    DataTransferRepositoryError | DataImportAlreadyActiveError
  >;

  readonly findJob: (input: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<
    Option.Option<DataImportJobRecord>,
    DataTransferRepositoryError
  >;
  readonly listJobs: (input: {
    readonly organizationId: string;
    readonly limit: number;
  }) => Effect.Effect<
    readonly DataImportJobRecord[],
    DataTransferRepositoryError
  >;
  readonly listRows: (input: {
    readonly jobId: string;
    readonly limit: number;
    readonly offset: number;
    readonly filter?: TDataImportRowFilter | undefined;
    readonly board?: string | undefined;
    readonly message?: string | undefined;
    readonly sort?: TDataImportRowSort | undefined;
  }) => Effect.Effect<
    { readonly total: number; readonly rows: readonly DataImportRowRecord[] },
    DataTransferRepositoryError
  >;
  /** Whole-job counts, failure groups, and destination board groups. */
  readonly summarizeReport: (input: {
    readonly jobId: string;
  }) => Effect.Effect<DataImportReportSummary, DataTransferRepositoryError>;
  /** Distinct board names the job's pending rows will create, sorted. */
  readonly listNewBoardNames: (input: {
    readonly jobId: string;
  }) => Effect.Effect<readonly string[], DataTransferRepositoryError>;
  /**
   * One page of the problems report: failed rows plus rows with planned
   * substitutions, in file order. This is what the downloadable error report
   * carries, so it reads the stored message and the plan's warnings.
   */
  readonly listProblemRows: (input: {
    readonly jobId: string;
    readonly limit: number;
    readonly offset: number;
  }) => Effect.Effect<
    readonly DataImportProblemRow[],
    DataTransferRepositoryError
  >;

  /**
   * Rows an export would stream, so the cap can be checked before streaming.
   * A null `boardId` counts every board in the workspace.
   */
  readonly countPostsForCsv: (input: {
    readonly organizationId: string;
    readonly boardId: string | null;
    readonly includeArchived: boolean;
  }) => Effect.Effect<number, DataTransferRepositoryError>;
  /**
   * One keyset page of the export, ordered `(createdAt, id)` ascending, with
   * each row's board carried along. A null `boardId` reads every board.
   */
  readonly listPostCsvRows: (input: {
    readonly organizationId: string;
    readonly boardId: string | null;
    readonly includeArchived: boolean;
    readonly limit: number;
    readonly after: { readonly createdAt: Date; readonly id: string } | null;
  }) => Effect.Effect<readonly PostCsvSourceRow[], DataTransferRepositoryError>;

  /** Moves an `awaiting_confirmation` job to `queued`; None when it is not one. */
  readonly markQueued: (input: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<
    Option.Option<DataImportJobRecord>,
    DataTransferRepositoryError
  >;

  /** Cancels any active job of the workspace; false when there was none. */
  readonly cancelJob: (input: {
    readonly id: string;
    readonly organizationId: string;
  }) => Effect.Effect<boolean, DataTransferRepositoryError>;

  /** Claims the oldest queued or lease-expired job, or nothing when idle. */
  readonly claimNextJob: (input: {
    readonly leaseOwner: string;
    readonly leaseDurationMs: number;
  }) => Effect.Effect<
    Option.Option<ClaimedDataImportJob>,
    DataTransferRepositoryError
  >;
  readonly listPendingRows: (input: {
    readonly jobId: string;
    readonly limit: number;
  }) => Effect.Effect<
    readonly PendingDataImportRow[],
    DataTransferRepositoryError
  >;
  /**
   * Marks one row created, but only while it is still `pending` and its job
   * is still `running`. An empty update means another worker owns this job
   * now, or a cancel landed mid-batch; failing here is what rolls the row's
   * post insert back with it.
   */
  readonly markRowCreated: (input: {
    readonly jobId: string;
    readonly rowId: string;
    readonly postId: string;
  }) => Effect.Effect<void, DataTransferRepositoryError>;
  readonly markRowFailed: (input: {
    readonly rowId: string;
    readonly message: string;
  }) => Effect.Effect<void, DataTransferRepositoryError>;
  /** Rewrites the lease holder's job counts from its row ledger. */
  readonly syncCounts: (input: {
    readonly jobId: string;
    readonly leaseOwner: string;
  }) => Effect.Effect<DataImportCounts, DataTransferRepositoryError>;
  /** Terminal state, written only while `leaseOwner` still holds the job. */
  readonly finishJob: (input: {
    readonly jobId: string;
    readonly status: "completed" | "failed" | "canceled";
    readonly leaseOwner: string;
    readonly failureMessage?: string | undefined;
  }) => Effect.Effect<void, DataTransferRepositoryError>;
  /**
   * Extends the caller's lease. False means the job is no longer running or
   * belongs to another worker, so the caller must stop without writing.
   */
  readonly renewLease: (input: {
    readonly jobId: string;
    readonly leaseOwner: string;
    readonly leaseDurationMs: number;
  }) => Effect.Effect<boolean, DataTransferRepositoryError>;
  /** True while the job is still the running lease holder; false when canceled. */
  readonly isStillRunning: (input: {
    readonly jobId: string;
  }) => Effect.Effect<boolean, DataTransferRepositoryError>;
  readonly deleteExpiredJobs: Effect.Effect<void, DataTransferRepositoryError>;
}

const repositoryError = (operation: string) =>
  new DataTransferRepositoryError({ operation });

/** The partial index that makes "one active import per workspace" a rule. */
const ACTIVE_IMPORT_INDEX = "data_import_job_organization_active_uidx";

const isActiveImportViolation = <T>(error: T): boolean =>
  isUniqueViolation(error) &&
  getUniqueViolationConstraint(error) === ACTIVE_IMPORT_INDEX;

/** Normalizes any store failure to the repository's own tagged failure. */
const guard = <A, E, R>(
  operation: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, DataTransferRepositoryError, R> =>
  effect.pipe(
    Effect.mapError((error) =>
      Schema.is(DataTransferRepositoryError)(error)
        ? error
        : repositoryError(operation)
    )
  );

const decodeStagedRow = Schema.decodeUnknownEffect(
  Schema.NullOr(StagedDataImportRow)
);

/** How much of a planned body a report row carries into the preview. */
const CONTENT_PREVIEW_LENGTH = 280;

const previewContent = (content: string): string =>
  content.length <= CONTENT_PREVIEW_LENGTH
    ? content
    : `${content.slice(0, CONTENT_PREVIEW_LENGTH)}…`;

/** How much of one substitution message a report row carries. */
const WARNING_REPORT_LENGTH = 240;

/**
 * Bounds each warning before it leaves the module. A warning interpolates the
 * value the file gave (`eta`, a status name), so a long cell could otherwise
 * become a long message on every row report.
 */
const reportWarnings = (warnings: readonly string[]): readonly string[] =>
  warnings.map((warning) =>
    warning.length <= WARNING_REPORT_LENGTH
      ? warning
      : `${warning.slice(0, WARNING_REPORT_LENGTH)}…`
  );

/** True for a row whose plan stores at least one substitution. */
const rowHasWarnings = sql`jsonb_array_length(coalesce(${schema.dataImportRowTable.payload} -> 'warnings', '[]'::jsonb)) > 0`;

/** The filter's SQL. `warned` is a plan property, not an outcome. */
const rowFilterCondition = (filter: TDataImportRowFilter | undefined) => {
  if (filter === undefined) {
    return undefined;
  }
  return filter === "warned"
    ? rowHasWarnings
    : eq(schema.dataImportRowTable.outcome, filter);
};

const makeDataTransferRepository = Effect.gen(function* () {
  const db = yield* currentDb;

  const selectJob = (where: ReturnType<typeof and>) =>
    db.select(JOB_FIELDS).from(schema.dataImportJobTable).where(where).limit(1);

  return {
    hasActiveJob: ({ organizationId }) =>
      guard(
        "hasActiveJob",
        db
          .select({ id: schema.dataImportJobTable.id })
          .from(schema.dataImportJobTable)
          .where(
            and(
              eq(schema.dataImportJobTable.organizationId, organizationId),
              inArray(schema.dataImportJobTable.status, [...ACTIVE_STATUSES])
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows.length > 0))
      ),

    findPriorJobByHash: ({ organizationId, fileHash }) =>
      guard(
        "findPriorJobByHash",
        db
          .select({
            createdAt: schema.dataImportJobTable.createdAt,
            id: schema.dataImportJobTable.id,
          })
          .from(schema.dataImportJobTable)
          .where(
            and(
              eq(schema.dataImportJobTable.organizationId, organizationId),
              eq(schema.dataImportJobTable.fileHash, fileHash),
              // A staged-then-canceled job imported nothing, so warning that
              // the file "was already imported" would be a lie. Confirmation
              // is the point the file stopped being just a preview.
              or(
                isNotNull(schema.dataImportJobTable.confirmedAt),
                gt(schema.dataImportJobTable.createdCount, 0)
              )
            )
          )
          .orderBy(desc(schema.dataImportJobTable.createdAt))
          .limit(1)
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])))
      ),

    insertStagedJob: (input) =>
      db
        .transaction(() =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            const retentionExpiresAt = DateTime.fromDateUnsafe(now).pipe(
              DateTime.addDuration(Duration.millis(DATA_IMPORT_RETENTION_MS)),
              DateTime.toDate
            );
            const errorCount = input.rows.filter(
              (row) => row.outcome === "failed"
            ).length;
            const warningCount = input.rows.filter(
              (row) =>
                row.outcome === "pending" &&
                row.payload !== null &&
                row.payload.warnings.length > 0
            ).length;

            const [job] = yield* db
              .insert(schema.dataImportJobTable)
              .values({
                createdByMemberId: input.createdByMemberId,
                createdByUserId: input.createdByUserId,
                errorCount,
                fileName: input.fileName,
                fileHash: input.fileHash,
                id: input.id,
                notices: input.notices,
                organizationId: input.organizationId,
                retentionExpiresAt,
                rowCount: input.rows.length,
                status: "awaiting_confirmation",
                warningCount,
              })
              .returning(JOB_FIELDS);

            if (job === undefined) {
              return yield* repositoryError("insertStagedJob");
            }

            // Batched so one upload does not build a 20k-row statement.
            const INSERT_CHUNK = 500;
            for (
              let offset = 0;
              offset < input.rows.length;
              offset += INSERT_CHUNK
            ) {
              const chunk = input.rows.slice(offset, offset + INSERT_CHUNK);
              const values = yield* Effect.forEach(chunk, (row) =>
                DataImportRowId.generate.pipe(
                  Effect.map((id) => ({
                    id,
                    jobId: input.id,
                    message: row.message,
                    outcome: row.outcome,
                    payload: row.payload,
                    rowNumber: row.rowNumber,
                  }))
                )
              );
              yield* db.insert(schema.dataImportRowTable).values(values);
            }

            return job;
          })
        )
        .pipe(
          Effect.mapError((error) =>
            isActiveImportViolation(error)
              ? new DataImportAlreadyActiveError({
                  message: ACTIVE_IMPORT_MESSAGE,
                })
              : repositoryError("insertStagedJob")
          )
        ),

    findJob: ({ id, organizationId }) =>
      guard(
        "findJob",
        selectJob(
          and(
            eq(schema.dataImportJobTable.id, id),
            eq(schema.dataImportJobTable.organizationId, organizationId)
          )
        ).pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])))
      ),

    listJobs: ({ organizationId, limit }) =>
      guard(
        "listJobs",
        db
          .select(JOB_FIELDS)
          .from(schema.dataImportJobTable)
          .where(eq(schema.dataImportJobTable.organizationId, organizationId))
          .orderBy(desc(schema.dataImportJobTable.createdAt))
          .limit(limit)
      ),

    listRows: ({ jobId, limit, offset, filter, board, message, sort }) =>
      guard(
        "listRows",
        Effect.gen(function* () {
          const where = and(
            eq(schema.dataImportRowTable.jobId, jobId),
            rowFilterCondition(filter),
            message === undefined
              ? undefined
              : eq(schema.dataImportRowTable.message, message),
            board === undefined
              ? undefined
              : sql`${schema.dataImportRowTable.payload} ->> 'boardName' = ${board}`
          );
          const [totals] = yield* db
            .select({ total: sql<string | number>`count(*)` })
            .from(schema.dataImportRowTable)
            .where(where);
          const stored = yield* db
            .select({
              boardSlug: schema.boardTable.slug,
              id: schema.dataImportRowTable.id,
              message: schema.dataImportRowTable.message,
              outcome: schema.dataImportRowTable.outcome,
              payload: schema.dataImportRowTable.payload,
              postId: schema.dataImportRowTable.postId,
              postSlug: schema.postTable.slug,
              rowNumber: schema.dataImportRowTable.rowNumber,
            })
            .from(schema.dataImportRowTable)
            .leftJoin(
              schema.postTable,
              eq(schema.dataImportRowTable.postId, schema.postTable.id)
            )
            .leftJoin(
              schema.boardTable,
              eq(schema.postTable.boardId, schema.boardTable.id)
            )
            .where(where)
            .orderBy(
              sort === "row_desc"
                ? desc(schema.dataImportRowTable.rowNumber)
                : asc(schema.dataImportRowTable.rowNumber)
            )
            .limit(limit)
            .offset(offset);
          // The payload holds the plan a preview renders; it is narrowed to
          // the fields the report shows and never leaves the module whole.
          const rows = yield* Effect.forEach(stored, (row) =>
            decodeStagedRow(row.payload).pipe(
              Effect.orElseSucceed((): null => null),
              Effect.map((payload): DataImportRowRecord => ({
                boardName: payload?.boardName ?? null,
                boardSlug: row.boardSlug,
                contentPreview:
                  payload === null ? null : previewContent(payload.content),
                id: row.id,
                message: row.message,
                outcome: row.outcome,
                postId: row.postId,
                postSlug: row.postSlug,
                rowNumber: row.rowNumber,
                statusName: payload?.statusName ?? null,
                title: payload?.title ?? null,
                warnings:
                  payload === null ? [] : reportWarnings(payload.warnings),
              }))
            )
          );
          return { rows, total: Number(totals?.total ?? 0) };
        })
      ),

    summarizeReport: ({ jobId }) =>
      guard(
        "summarizeReport",
        Effect.gen(function* () {
          const [counts] = yield* db
            .select({
              created: sql<
                string | number
              >`count(*) filter (where ${schema.dataImportRowTable.outcome} = 'created')`,
              failed: sql<
                string | number
              >`count(*) filter (where ${schema.dataImportRowTable.outcome} = 'failed')`,
              pending: sql<
                string | number
              >`count(*) filter (where ${schema.dataImportRowTable.outcome} = 'pending')`,
              total: sql<string | number>`count(*)`,
              warned: sql<
                string | number
              >`count(*) filter (where ${rowHasWarnings})`,
            })
            .from(schema.dataImportRowTable)
            .where(eq(schema.dataImportRowTable.jobId, jobId));
          const failureRows = yield* db
            .select({
              count: sql<string | number>`count(*)`,
              message: schema.dataImportRowTable.message,
            })
            .from(schema.dataImportRowTable)
            .where(
              and(
                eq(schema.dataImportRowTable.jobId, jobId),
                eq(schema.dataImportRowTable.outcome, "failed"),
                isNotNull(schema.dataImportRowTable.message)
              )
            )
            .groupBy(schema.dataImportRowTable.message)
            .orderBy(
              desc(sql`count(*)`),
              asc(schema.dataImportRowTable.message)
            );
          const boardRows = yield* db
            .select({
              count: sql<string | number>`count(*)`,
              name: sql<
                string | null
              >`${schema.dataImportRowTable.payload} ->> 'boardName'`,
            })
            .from(schema.dataImportRowTable)
            .where(
              and(
                eq(schema.dataImportRowTable.jobId, jobId),
                sql`${schema.dataImportRowTable.payload} ->> 'boardName' is not null`
              )
            )
            .groupBy(sql`${schema.dataImportRowTable.payload} ->> 'boardName'`)
            .orderBy(
              desc(sql`count(*)`),
              asc(sql`${schema.dataImportRowTable.payload} ->> 'boardName'`)
            );
          return {
            boardGroups: boardRows.flatMap((row) =>
              row.name === null
                ? []
                : [{ count: Number(row.count), name: row.name }]
            ),
            counts: {
              created: Number(counts?.created ?? 0),
              failed: Number(counts?.failed ?? 0),
              pending: Number(counts?.pending ?? 0),
              total: Number(counts?.total ?? 0),
              warned: Number(counts?.warned ?? 0),
            },
            failureGroups: failureRows.flatMap((row) =>
              row.message === null
                ? []
                : [{ count: Number(row.count), message: row.message }]
            ),
          };
        })
      ),

    listNewBoardNames: ({ jobId }) =>
      guard(
        "listNewBoardNames",
        db
          .selectDistinct({
            name: sql<
              string | null
            >`${schema.dataImportRowTable.payload} ->> 'boardName'`,
          })
          .from(schema.dataImportRowTable)
          .where(
            and(
              eq(schema.dataImportRowTable.jobId, jobId),
              eq(schema.dataImportRowTable.outcome, "pending"),
              sql`${schema.dataImportRowTable.payload} ->> 'boardId' is null`
            )
          )
          .orderBy(
            asc(sql`${schema.dataImportRowTable.payload} ->> 'boardName'`)
          )
          .pipe(
            Effect.map((rows) =>
              rows.flatMap((row) => (row.name === null ? [] : [row.name]))
            )
          )
      ),

    listProblemRows: ({ jobId, limit, offset }) =>
      guard(
        "listProblemRows",
        Effect.gen(function* () {
          const stored = yield* db
            .select({
              message: schema.dataImportRowTable.message,
              outcome: schema.dataImportRowTable.outcome,
              payload: schema.dataImportRowTable.payload,
              rowNumber: schema.dataImportRowTable.rowNumber,
            })
            .from(schema.dataImportRowTable)
            .where(
              and(
                eq(schema.dataImportRowTable.jobId, jobId),
                sql`(${schema.dataImportRowTable.outcome} = 'failed' or ${rowHasWarnings})`
              )
            )
            .orderBy(asc(schema.dataImportRowTable.rowNumber))
            .limit(limit)
            .offset(offset);
          return yield* Effect.forEach(stored, (row) =>
            decodeStagedRow(row.payload).pipe(
              Effect.orElseSucceed((): null => null),
              Effect.map((payload): DataImportProblemRow => ({
                boardName: payload?.boardName ?? null,
                message: row.message,
                outcome: row.outcome,
                rowNumber: row.rowNumber,
                statusName: payload?.statusName ?? null,
                title: payload?.title ?? null,
                warnings:
                  payload === null ? [] : reportWarnings(payload.warnings),
              }))
            )
          );
        })
      ),

    countPostsForCsv: ({ boardId, includeArchived, organizationId }) =>
      guard(
        "countPostsForCsv",
        db
          .select({ total: sql<string | number>`count(*)` })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.organizationId, organizationId),
              ...(boardId === null
                ? []
                : [eq(schema.postTable.boardId, boardId)]),
              ...(includeArchived ? [] : [isNull(schema.postTable.archivedAt)])
            )
          )
          .pipe(Effect.map((rows) => Number(rows[0]?.total ?? 0)))
      ),

    listPostCsvRows: ({
      after,
      boardId,
      includeArchived,
      limit,
      organizationId,
    }) =>
      guard(
        "listPostCsvRows",
        Effect.gen(function* () {
          const posts = yield* db
            .select({
              boardName: schema.boardTable.name,
              boardSlug: schema.boardTable.slug,
              contactEmail: schema.contactTable.email,
              contactName: schema.contactTable.name,
              content: schema.postTable.content,
              createdAt: schema.postTable.createdAt,
              creatorEmail: schema.userTable.email,
              creatorName: schema.userTable.name,
              etaQuarter: schema.postTable.etaQuarter,
              id: schema.postTable.id,
              slug: schema.postTable.slug,
              statusLabel: schema.postStatusTable.label,
              statusType: schema.postStatusTable.type,
              title: schema.postTable.title,
              updatedAt: schema.postTable.updatedAt,
              voteCount: sql<
                string | number
              >`(select count(*) from ${schema.upvoteTable} where ${schema.upvoteTable.postId} = ${schema.postTable.id})`,
            })
            .from(schema.postTable)
            .innerJoin(
              schema.postStatusTable,
              eq(schema.postStatusTable.id, schema.postTable.statusId)
            )
            .innerJoin(
              schema.boardTable,
              eq(schema.boardTable.id, schema.postTable.boardId)
            )
            .leftJoin(
              schema.contactTable,
              eq(schema.contactTable.id, schema.postTable.contactId)
            )
            .leftJoin(
              schema.userTable,
              eq(schema.userTable.id, schema.postTable.creatorId)
            )
            .where(
              and(
                eq(schema.postTable.organizationId, organizationId),
                ...(boardId === null
                  ? []
                  : [eq(schema.postTable.boardId, boardId)]),
                ...(includeArchived
                  ? []
                  : [isNull(schema.postTable.archivedAt)]),
                ...(after === null
                  ? []
                  : [
                      sql`(${schema.postTable.createdAt}, ${schema.postTable.id}) > (${after.createdAt}, ${after.id})`,
                    ])
              )
            )
            .orderBy(asc(schema.postTable.createdAt), asc(schema.postTable.id))
            .limit(limit);

          if (posts.length === 0) {
            return [];
          }

          const tagRows = yield* db
            .select({
              name: schema.tagTable.name,
              postId: schema.postTagTable.postId,
            })
            .from(schema.postTagTable)
            .innerJoin(
              schema.tagTable,
              eq(schema.tagTable.id, schema.postTagTable.tagId)
            )
            .where(
              inArray(
                schema.postTagTable.postId,
                posts.map((post) => post.id)
              )
            )
            .orderBy(asc(schema.tagTable.name));
          const tagsByPost = new Map<string, string[]>();
          for (const tag of tagRows) {
            const names = tagsByPost.get(tag.postId) ?? [];
            names.push(tag.name);
            tagsByPost.set(tag.postId, names);
          }

          return posts.map((post): PostCsvSourceRow => ({
            authorEmail: post.contactEmail ?? post.creatorEmail,
            authorName: post.contactName ?? post.creatorName,
            boardName: post.boardName,
            boardSlug: post.boardSlug,
            content: post.content,
            createdAt: post.createdAt,
            etaQuarter: post.etaQuarter,
            id: post.id,
            slug: post.slug,
            statusLabel: post.statusLabel,
            statusType: post.statusType,
            tags: tagsByPost.get(post.id) ?? [],
            title: post.title,
            updatedAt: post.updatedAt,
            voteCount: Number(post.voteCount),
          }));
        })
      ),

    markQueued: ({ id, organizationId }) =>
      guard(
        "markQueued",
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const [job] = yield* db
            .update(schema.dataImportJobTable)
            .set({ confirmedAt: now, status: "queued", updatedAt: now })
            .where(
              and(
                eq(schema.dataImportJobTable.id, id),
                eq(schema.dataImportJobTable.organizationId, organizationId),
                eq(schema.dataImportJobTable.status, "awaiting_confirmation")
              )
            )
            .returning(JOB_FIELDS);
          return Option.fromNullishOr(job);
        })
      ),

    cancelJob: ({ id, organizationId }) =>
      guard(
        "cancelJob",
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const updated = yield* db
            .update(schema.dataImportJobTable)
            .set({
              finishedAt: now,
              leaseExpiresAt: null,
              // The lease owner is kept: the canceled worker's last
              // `syncCounts` still matches on it and records the rows it had
              // already created. Every other write is guarded by
              // `status = running`, so a canceled job cannot be resurrected.
              status: "canceled",
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.dataImportJobTable.id, id),
                eq(schema.dataImportJobTable.organizationId, organizationId),
                inArray(schema.dataImportJobTable.status, [...ACTIVE_STATUSES])
              )
            )
            .returning({ id: schema.dataImportJobTable.id });
          return updated.length > 0;
        })
      ),

    claimNextJob: ({ leaseOwner, leaseDurationMs }) =>
      guard(
        "claimNextJob",
        db.transaction(() =>
          Effect.gen(function* () {
            const now = yield* DateTime.nowAsDate;
            const [candidate] = yield* db
              .select({ id: schema.dataImportJobTable.id })
              .from(schema.dataImportJobTable)
              .where(
                or(
                  eq(schema.dataImportJobTable.status, "queued"),
                  and(
                    eq(schema.dataImportJobTable.status, "running"),
                    lte(schema.dataImportJobTable.leaseExpiresAt, now)
                  )
                )
              )
              .orderBy(asc(schema.dataImportJobTable.createdAt))
              .limit(1)
              .for("update", { skipLocked: true });

            if (candidate === undefined) {
              return Option.none<ClaimedDataImportJob>();
            }

            const leaseExpiresAt = DateTime.fromDateUnsafe(now).pipe(
              DateTime.addDuration(Duration.millis(leaseDurationMs)),
              DateTime.toDate
            );
            const [job] = yield* db
              .update(schema.dataImportJobTable)
              .set({
                leaseExpiresAt,
                leaseOwner,
                startedAt: sql`coalesce(${schema.dataImportJobTable.startedAt}, ${now})`,
                status: "running",
                updatedAt: now,
              })
              .where(eq(schema.dataImportJobTable.id, candidate.id))
              .returning(JOB_FIELDS);

            return job === undefined
              ? Option.none<ClaimedDataImportJob>()
              : Option.some({ job, leaseOwner });
          })
        )
      ),

    listPendingRows: ({ jobId, limit }) =>
      guard(
        "listPendingRows",
        db
          .select({
            id: schema.dataImportRowTable.id,
            payload: schema.dataImportRowTable.payload,
            rowNumber: schema.dataImportRowTable.rowNumber,
          })
          .from(schema.dataImportRowTable)
          .where(
            and(
              eq(schema.dataImportRowTable.jobId, jobId),
              eq(schema.dataImportRowTable.outcome, "pending")
            )
          )
          .orderBy(asc(schema.dataImportRowTable.rowNumber))
          .limit(limit)
          .pipe(
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) =>
                decodeStagedRow(row.payload).pipe(
                  Effect.map((payload) => ({ ...row, payload }))
                )
              )
            )
          )
      ),

    markRowCreated: ({ jobId, rowId, postId }) =>
      guard(
        "markRowCreated",
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const updated = yield* db
            .update(schema.dataImportRowTable)
            .set({
              message: null,
              outcome: "created",
              postId,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.dataImportRowTable.id, rowId),
                eq(schema.dataImportRowTable.outcome, "pending"),
                // The job check is what makes a cancel win the race: a
                // cancellation that lands while this transaction is open
                // leaves the post unapplied instead of creating it after
                // the cancel the uploader already saw.
                exists(
                  db
                    .select({ id: schema.dataImportJobTable.id })
                    .from(schema.dataImportJobTable)
                    .where(
                      and(
                        eq(schema.dataImportJobTable.id, jobId),
                        eq(schema.dataImportJobTable.status, "running")
                      )
                    )
                )
              )
            )
            .returning({ id: schema.dataImportRowTable.id });
          if (updated.length === 0) {
            return yield* repositoryError("markRowCreated");
          }
        })
      ),

    markRowFailed: ({ rowId, message }) =>
      guard(
        "markRowFailed",
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          yield* db
            .update(schema.dataImportRowTable)
            .set({ message, outcome: "failed", updatedAt: now })
            .where(
              and(
                eq(schema.dataImportRowTable.id, rowId),
                eq(schema.dataImportRowTable.outcome, "pending")
              )
            );
        })
      ),

    syncCounts: ({ jobId, leaseOwner }) =>
      guard(
        "syncCounts",
        Effect.gen(function* () {
          const grouped = yield* db
            .select({
              outcome: schema.dataImportRowTable.outcome,
              total: sql<string | number>`count(*)`,
            })
            .from(schema.dataImportRowTable)
            .where(eq(schema.dataImportRowTable.jobId, jobId))
            .groupBy(schema.dataImportRowTable.outcome);
          const byOutcome = new Map(
            grouped.map((row) => [row.outcome, Number(row.total)])
          );
          const counts: DataImportCounts = {
            createdCount: byOutcome.get("created") ?? 0,
            errorCount: byOutcome.get("failed") ?? 0,
          };
          const now = yield* DateTime.nowAsDate;
          yield* db
            .update(schema.dataImportJobTable)
            .set({
              createdCount: counts.createdCount,
              errorCount: counts.errorCount,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.dataImportJobTable.id, jobId),
                eq(schema.dataImportJobTable.leaseOwner, leaseOwner)
              )
            );
          return counts;
        })
      ),

    finishJob: ({ jobId, leaseOwner, status, failureMessage }) =>
      guard(
        "finishJob",
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          yield* db
            .update(schema.dataImportJobTable)
            .set({
              failureMessage: failureMessage ?? null,
              finishedAt: now,
              leaseExpiresAt: null,
              leaseOwner: null,
              status,
              updatedAt: now,
            })
            .where(
              and(
                eq(schema.dataImportJobTable.id, jobId),
                eq(schema.dataImportJobTable.status, "running"),
                eq(schema.dataImportJobTable.leaseOwner, leaseOwner)
              )
            );
        })
      ),

    renewLease: ({ jobId, leaseDurationMs, leaseOwner }) =>
      guard(
        "renewLease",
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          const leaseExpiresAt = DateTime.fromDateUnsafe(now).pipe(
            DateTime.addDuration(Duration.millis(leaseDurationMs)),
            DateTime.toDate
          );
          const updated = yield* db
            .update(schema.dataImportJobTable)
            .set({ leaseExpiresAt, updatedAt: now })
            .where(
              and(
                eq(schema.dataImportJobTable.id, jobId),
                eq(schema.dataImportJobTable.status, "running"),
                eq(schema.dataImportJobTable.leaseOwner, leaseOwner)
              )
            )
            .returning({ id: schema.dataImportJobTable.id });
          return updated.length > 0;
        })
      ),

    isStillRunning: ({ jobId }) =>
      guard(
        "isStillRunning",
        db
          .select({ id: schema.dataImportJobTable.id })
          .from(schema.dataImportJobTable)
          .where(
            and(
              eq(schema.dataImportJobTable.id, jobId),
              eq(schema.dataImportJobTable.status, "running")
            )
          )
          .limit(1)
          .pipe(Effect.map((rows) => rows.length > 0))
      ),

    deleteExpiredJobs: guard(
      "deleteExpiredJobs",
      Effect.gen(function* () {
        const now = yield* DateTime.nowAsDate;
        yield* db
          .delete(schema.dataImportJobTable)
          .where(lte(schema.dataImportJobTable.retentionExpiresAt, now));
      })
    ),
  } satisfies DataTransferRepositoryContract;
});

export class DataTransferRepository extends Context.Service<
  DataTransferRepository,
  DataTransferRepositoryContract
>()("DataTransferRepository", {
  make: makeDataTransferRepository,
}) {
  static readonly layer = Layer.effect(this, this.make);
}

export const currentDataTransferRepository = Effect.context<never>().pipe(
  Effect.map((context) => Context.getUnsafe(context, DataTransferRepository))
);

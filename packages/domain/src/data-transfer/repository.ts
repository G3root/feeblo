import { currentDb, schema } from "@feeblo/db";
import type {
  TDataImportRowOutcome,
  TDataImportStatus,
  TStagedDataImportRow,
} from "@feeblo/db/validation-schema/data-import";
import { StagedDataImportRow } from "@feeblo/domain-contracts/data-import";
import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";
import { DataImportRowId } from "@feeblo/id";
import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { DataTransferRepositoryError } from "./errors";
import { DATA_IMPORT_RETENTION_MS } from "./limits";

/** The active states; a job in one of these owns its workspace's transfer slot. */
const ACTIVE_STATUSES = [
  "awaiting_confirmation",
  "queued",
  "running",
] as const satisfies readonly TDataImportStatus[];

const JOB_FIELDS = {
  boardId: schema.dataImportJobTable.boardId,
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
} as const;

/** One staged import as the application reads it; never a raw table row. */
export type DataImportJobRecord = {
  readonly id: string;
  readonly organizationId: string;
  readonly boardId: string;
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
};

/** One row as the report reads it. The payload is deliberately absent. */
export type DataImportRowRecord = {
  readonly id: string;
  readonly rowNumber: number;
  readonly outcome: TDataImportRowOutcome;
  readonly message: string | null;
  readonly postId: string | null;
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
export type BoardPostCsvSourceRow = {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly content: string;
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
  /** The most recent job that uploaded the same bytes, for the confirm warning. */
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
    readonly boardId: string;
    readonly createdByUserId: string | null;
    readonly createdByMemberId: string | null;
    readonly fileName: string;
    readonly fileHash: string;
    readonly notices: readonly string[];
    readonly rows: readonly NewStagedImportRow[];
  }) => Effect.Effect<DataImportJobRecord, DataTransferRepositoryError>;

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
  }) => Effect.Effect<
    { readonly total: number; readonly rows: readonly DataImportRowRecord[] },
    DataTransferRepositoryError
  >;

  /** Rows an export would stream, so the cap can be checked before streaming. */
  readonly countBoardPostsForCsv: (input: {
    readonly organizationId: string;
    readonly boardId: string;
    readonly includeArchived: boolean;
  }) => Effect.Effect<number, DataTransferRepositoryError>;
  /** One keyset page of the export, ordered `(createdAt, id)` ascending. */
  readonly listBoardPostCsvRows: (input: {
    readonly organizationId: string;
    readonly boardId: string;
    readonly includeArchived: boolean;
    readonly limit: number;
    readonly after: { readonly createdAt: Date; readonly id: string } | null;
  }) => Effect.Effect<
    readonly BoardPostCsvSourceRow[],
    DataTransferRepositoryError
  >;

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
  readonly markRowCreated: (input: {
    readonly rowId: string;
    readonly postId: string;
  }) => Effect.Effect<void, DataTransferRepositoryError>;
  readonly markRowFailed: (input: {
    readonly rowId: string;
    readonly message: string;
  }) => Effect.Effect<void, DataTransferRepositoryError>;
  /** Rewrites a job's counts from its row ledger, the report's single source. */
  readonly syncCounts: (input: {
    readonly jobId: string;
  }) => Effect.Effect<DataImportCounts, DataTransferRepositoryError>;
  readonly finishJob: (input: {
    readonly jobId: string;
    readonly status: "completed" | "failed" | "canceled";
    readonly failureMessage?: string | undefined;
  }) => Effect.Effect<void, DataTransferRepositoryError>;
  /** True while the job is still the running lease holder; false when canceled. */
  readonly isStillRunning: (input: {
    readonly jobId: string;
  }) => Effect.Effect<boolean, DataTransferRepositoryError>;
  readonly deleteExpiredJobs: Effect.Effect<void, DataTransferRepositoryError>;
}

const repositoryError = (operation: string) =>
  new DataTransferRepositoryError({ operation });

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
              eq(schema.dataImportJobTable.fileHash, fileHash)
            )
          )
          .orderBy(desc(schema.dataImportJobTable.createdAt))
          .limit(1)
          .pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])))
      ),

    insertStagedJob: (input) =>
      guard(
        "insertStagedJob",
        db.transaction(() =>
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
                boardId: input.boardId,
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

    listRows: ({ jobId, limit, offset }) =>
      guard(
        "listRows",
        Effect.gen(function* () {
          const [totals] = yield* db
            .select({ total: sql<string | number>`count(*)` })
            .from(schema.dataImportRowTable)
            .where(eq(schema.dataImportRowTable.jobId, jobId));
          const rows = yield* db
            .select({
              id: schema.dataImportRowTable.id,
              message: schema.dataImportRowTable.message,
              outcome: schema.dataImportRowTable.outcome,
              postId: schema.dataImportRowTable.postId,
              rowNumber: schema.dataImportRowTable.rowNumber,
            })
            .from(schema.dataImportRowTable)
            .where(eq(schema.dataImportRowTable.jobId, jobId))
            .orderBy(asc(schema.dataImportRowTable.rowNumber))
            .limit(limit)
            .offset(offset);
          return { rows, total: Number(totals?.total ?? 0) };
        })
      ),

    countBoardPostsForCsv: ({ boardId, includeArchived, organizationId }) =>
      guard(
        "countBoardPostsForCsv",
        db
          .select({ total: sql<string | number>`count(*)` })
          .from(schema.postTable)
          .where(
            and(
              eq(schema.postTable.organizationId, organizationId),
              eq(schema.postTable.boardId, boardId),
              ...(includeArchived ? [] : [isNull(schema.postTable.archivedAt)])
            )
          )
          .pipe(Effect.map((rows) => Number(rows[0]?.total ?? 0)))
      ),

    listBoardPostCsvRows: ({
      after,
      boardId,
      includeArchived,
      limit,
      organizationId,
    }) =>
      guard(
        "listBoardPostCsvRows",
        Effect.gen(function* () {
          const posts = yield* db
            .select({
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
                eq(schema.postTable.boardId, boardId),
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

          return posts.map((post): BoardPostCsvSourceRow => ({
            authorEmail: post.contactEmail ?? post.creatorEmail,
            authorName: post.contactName ?? post.creatorName,
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
              leaseOwner: null,
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

    markRowCreated: ({ rowId, postId }) =>
      guard(
        "markRowCreated",
        Effect.gen(function* () {
          const now = yield* DateTime.nowAsDate;
          yield* db
            .update(schema.dataImportRowTable)
            .set({
              message: null,
              outcome: "created",
              postId,
              updatedAt: now,
            })
            .where(eq(schema.dataImportRowTable.id, rowId));
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
            .where(eq(schema.dataImportRowTable.id, rowId));
        })
      ),

    syncCounts: ({ jobId }) =>
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
            .where(eq(schema.dataImportJobTable.id, jobId));
          return counts;
        })
      ),

    finishJob: ({ jobId, status, failureMessage }) =>
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
                eq(schema.dataImportJobTable.status, "running")
              )
            );
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

import { DataImportJobId, type LegidError } from "@feeblo/id";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Filter from "effect/Filter";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";

import { BoardRepository } from "../board/repository";
import * as Policy from "../policy";
import { PostStatusRepository } from "../post-status/repository";
import { InternalServerError, withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { decodeBoardPostCsv, parseBoardPostCsv } from "./csv";
import {
  ACTIVE_IMPORT_MESSAGE,
  DataImportAlreadyActiveError,
  DataImportFileTooLargeError,
  DataImportNotConfirmableError,
  DataImportNotFoundError,
  DataImportRowLimitError,
  type DataTransferRepositoryError,
  InvalidBoardPostCsvError,
} from "./errors";
import { DATA_IMPORT_MAX_BYTES, DATA_IMPORT_WATCH_MS } from "./limits";
import { planImportRows } from "./plan";
import { canImportPosts } from "./policies";
import {
  type DataImportJobRecord,
  type DataImportRowRecord,
  DataTransferRepository,
  type NewStagedImportRow,
} from "./repository";
import {
  BOARD_IMPORT_DEFAULT_REPORT_LIMIT,
  BOARD_IMPORT_MAX_REPORT_LIMIT,
} from "./schema";

export type StageBoardImportInput = {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly organizationId: string;
  readonly userId: string;
  readonly memberId: string | null;
};

export type DataImportJobDetail = {
  readonly job: DataImportJobRecord;
  readonly report: {
    readonly rows: readonly DataImportRowRecord[];
    readonly total: number;
  };
};

export type DescribeImportInput = {
  readonly organizationId: string;
  readonly id: string;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
};

export type DataImportServiceContract = {
  readonly stageBoardImport: (
    input: StageBoardImportInput
  ) => Effect.Effect<
    DataImportJobRecord,
    | InvalidBoardPostCsvError
    | DataImportRowLimitError
    | DataImportFileTooLargeError
    | DataImportAlreadyActiveError
    | Policy.PolicyDeniedError
    | InternalServerError
    | LegidError,
    CurrentSession
  >;
  readonly confirmImport: (input: {
    readonly organizationId: string;
    readonly id: string;
  }) => Effect.Effect<
    void,
    | DataImportNotFoundError
    | DataImportNotConfirmableError
    | Policy.PolicyDeniedError
    | InternalServerError,
    CurrentSession
  >;
  readonly cancelImport: (input: {
    readonly organizationId: string;
    readonly id: string;
  }) => Effect.Effect<
    void,
    DataImportNotFoundError | Policy.PolicyDeniedError | InternalServerError,
    CurrentSession
  >;
  readonly describeImport: (
    input: DescribeImportInput
  ) => Effect.Effect<
    DataImportJobDetail,
    DataImportNotFoundError | Policy.PolicyDeniedError | InternalServerError,
    CurrentSession
  >;
  readonly listImports: (input: {
    readonly organizationId: string;
  }) => Effect.Effect<
    readonly DataImportJobRecord[],
    Policy.PolicyDeniedError | InternalServerError,
    CurrentSession
  >;
  /**
   * The job's current snapshot, re-read on an interval and re-emitted only
   * when something a viewer sees changed. Ends after the first terminal
   * snapshot: a finished job has nothing left to report.
   */
  readonly watchImport: (
    input: DescribeImportInput
  ) => Stream.Stream<
    DataImportJobDetail,
    DataImportNotFoundError | Policy.PolicyDeniedError | InternalServerError,
    CurrentSession
  >;
  /**
   * The workspace's job list, re-read on an interval and re-emitted only when
   * a job row changed. The stream stays open: another upload can arrive at
   * any time.
   */
  readonly watchImportList: (input: {
    readonly organizationId: string;
  }) => Stream.Stream<
    readonly DataImportJobRecord[],
    Policy.PolicyDeniedError | InternalServerError,
    CurrentSession
  >;
};

/** The most recent jobs a workspace sees, newest first. */
const IMPORT_JOB_LIST_LIMIT = 20;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

const hashBytes = (
  crypto: Crypto.Crypto,
  bytes: Uint8Array
): Effect.Effect<string, InternalServerError> =>
  crypto.digest("SHA-256", bytes).pipe(
    Effect.mapError(
      () =>
        new InternalServerError({
          message: "Could not fingerprint the uploaded file.",
        })
    ),
    Effect.map(toHex)
  );

/** Normalizes a store failure to one stable internal failure. */
const fromStore = <A, R>(
  operation: string,
  effect: Effect.Effect<A, DataTransferRepositoryError, R>
): Effect.Effect<A, InternalServerError, R> =>
  effect.pipe(
    Effect.catchTag("DataTransferRepositoryError", () =>
      Effect.fail(
        new InternalServerError({
          message: `The import store failed during ${operation}.`,
        })
      )
    )
  );

const clampReportWindow = (
  limit: number | undefined,
  offset: number | undefined
) => ({
  limit: Math.min(
    Math.max(limit ?? BOARD_IMPORT_DEFAULT_REPORT_LIMIT, 1),
    BOARD_IMPORT_MAX_REPORT_LIMIT
  ),
  offset: Math.max(offset ?? 0, 0),
});

/**
 * A job still moves through these statuses on its own; everything else is
 * final. A detail watch writes its last snapshot and ends on the transition
 * out.
 */
const statusIsActive = (status: DataImportJobRecord["status"]): boolean =>
  status === "awaiting_confirmation" ||
  status === "queued" ||
  status === "running";

/**
 * A cheap key over the fields of a job a viewer sees change while it runs.
 * Two snapshots with the same key are the same picture, so a watch tick that
 * finds nothing new stays silent instead of waking every subscriber.
 */
const jobChangeKey = (job: DataImportJobRecord): string =>
  [
    job.id,
    job.status,
    job.createdCount,
    job.warningCount,
    job.errorCount,
    job.finishedAt?.getTime() ?? 0,
    job.failureMessage ?? "",
  ].join("\u0000");

/** The job key plus the visible shape of the one report page being watched. */
const reportChangeKey = (detail: DataImportJobDetail): string =>
  [
    jobChangeKey(detail.job),
    detail.report.total,
    ...detail.report.rows.map(
      (row) => `${row.id}\u0000${row.outcome}\u0000${row.postId ?? ""}`
    ),
  ].join("\u0001");

/** Drops stream values whose change key matches the previous emission. */
const excludeUnchanged =
  <A, E, R>(keyOf: (value: A) => string) =>
  (self: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    self.pipe(
      Stream.mapAccum(
        () => "",
        (previous: string, value: A): readonly [string, ReadonlyArray<A>] => {
          const key = keyOf(value);
          return key === previous ? [previous, []] : [key, [value]];
        }
      )
    );

/**
 * One watch tick. An infrastructure failure is not a reason to end a watch
 * that the next tick may recover from — the same stance the worker's pass
 * loop takes — so it suppresses that tick and lets the schedule retry. The
 * typed domain failures (denied, not found) stay fatal: retrying those would
 * spin forever without a way out.
 */
const suppressInternalFailures = <A, E, R>(
  effect: Effect.Effect<A, E | InternalServerError, R>
): Effect.Effect<Option.Option<A>, E, R> =>
  effect.pipe(
    Effect.map(Option.some),
    Effect.catchTag("InternalServerError", () =>
      Effect.succeed(Option.none<A>())
    )
  );

const makeDataImportService = Effect.gen(function* () {
  const repository = yield* DataTransferRepository;
  const boards = yield* BoardRepository;
  const statuses = yield* PostStatusRepository;
  const crypto = yield* Crypto.Crypto;

  const stageBoardImport: DataImportServiceContract["stageBoardImport"] = (
    input
  ) =>
    Effect.gen(function* () {
      if (input.bytes.byteLength > DATA_IMPORT_MAX_BYTES) {
        return yield* new DataImportFileTooLargeError({
          maxBytes: DATA_IMPORT_MAX_BYTES,
          message: `The file is larger than ${Math.round(
            DATA_IMPORT_MAX_BYTES / (1024 * 1024)
          )} MB.`,
        });
      }

      const hasActive = yield* fromStore(
        "hasActiveJob",
        repository.hasActiveJob({ organizationId: input.organizationId })
      );
      if (hasActive) {
        return yield* new DataImportAlreadyActiveError({
          message: ACTIVE_IMPORT_MESSAGE,
        });
      }

      // Imports are not scoped to a board: the `board` column routes every
      // row. The oldest board is the fallback for a row with an empty cell,
      // and is null only when the workspace has no boards at all. The read
      // and the sort happen here so the plan stays a pure function of them.
      const existingBoards = yield* boards
        .findMany({ organizationId: input.organizationId })
        .pipe(withRemapDbErrors("Board", "select"));
      const sortedBoards = [...existingBoards].sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          left.id.localeCompare(right.id)
      );
      const [defaultBoard = null] = sortedBoards;

      const text = yield* decodeBoardPostCsv(input.bytes);
      const fileHash = yield* hashBytes(crypto, input.bytes);

      const statusRows = yield* statuses
        .findMany({ organizationId: input.organizationId })
        .pipe(withRemapDbErrors("PostStatus", "select"));
      const fallbackStatus =
        statusRows.find((status) => status.type === "PENDING") ?? statusRows[0];
      if (fallbackStatus === undefined) {
        return yield* new InternalServerError({
          message:
            "This workspace has no post statuses. Add one before importing posts.",
        });
      }

      const parsed = yield* parseBoardPostCsv(text);
      const prior = yield* fromStore(
        "findPriorJobByHash",
        repository.findPriorJobByHash({
          fileHash,
          organizationId: input.organizationId,
        })
      );
      const plan = planImportRows({
        boards: sortedBoards,
        defaultBoard,
        defaultStatus: fallbackStatus,
        rows: parsed.rows,
        statuses: statusRows,
      });

      const priorNotices = Option.match(prior, {
        onNone: (): readonly string[] => [],
        onSome: (job) => [
          `This file was already imported on ${job.createdAt
            .toISOString()
            .slice(0, 10)}.`,
        ],
      });

      const rows: readonly NewStagedImportRow[] = plan.rows.map((row) =>
        row.kind === "pending"
          ? {
              message: null,
              outcome: "pending",
              payload: row.payload,
              rowNumber: row.rowNumber,
            }
          : {
              message: row.message,
              outcome: "failed",
              payload: null,
              rowNumber: row.rowNumber,
            }
      );

      const jobId = yield* DataImportJobId.generate;
      return yield* repository
        .insertStagedJob({
          createdByMemberId: input.memberId,
          createdByUserId: input.userId,
          fileName: input.fileName,
          fileHash,
          id: jobId,
          notices: [...parsed.notices, ...plan.notices, ...priorNotices],
          organizationId: input.organizationId,
          rows,
        })
        .pipe(
          Effect.catchTag("DataTransferRepositoryError", () =>
            Effect.fail(
              new InternalServerError({
                message: "The import store failed during insertStagedJob.",
              })
            )
          )
        );
    }).pipe(Policy.withPolicy(canImportPosts(input.organizationId)));

  const confirmImport: DataImportServiceContract["confirmImport"] = (input) =>
    Effect.gen(function* () {
      const queued = yield* fromStore(
        "markQueued",
        repository.markQueued({
          id: input.id,
          organizationId: input.organizationId,
        })
      );
      if (Option.isSome(queued)) {
        return;
      }
      const job = yield* fromStore(
        "findJob",
        repository.findJob({
          id: input.id,
          organizationId: input.organizationId,
        })
      );
      if (Option.isNone(job)) {
        return yield* new DataImportNotFoundError({
          message: "No import with this id exists in this workspace.",
        });
      }
      return yield* new DataImportNotConfirmableError({
        status: job.value.status,
        message: `This import is ${job.value.status.replaceAll("_", " ")} and cannot be confirmed.`,
      });
    }).pipe(Policy.withPolicy(canImportPosts(input.organizationId)));

  const cancelImport: DataImportServiceContract["cancelImport"] = (input) =>
    Effect.gen(function* () {
      const canceled = yield* fromStore(
        "cancelJob",
        repository.cancelJob({
          id: input.id,
          organizationId: input.organizationId,
        })
      );
      if (canceled) {
        return;
      }
      const job = yield* fromStore(
        "findJob",
        repository.findJob({
          id: input.id,
          organizationId: input.organizationId,
        })
      );
      if (Option.isNone(job)) {
        return yield* new DataImportNotFoundError({
          message: "No import with this id exists in this workspace.",
        });
      }
      // A finished or already-canceled job is not an error: cancel is
      // idempotent, and the caller's intent is satisfied either way.
    }).pipe(Policy.withPolicy(canImportPosts(input.organizationId)));

  const describeImport: DataImportServiceContract["describeImport"] = (input) =>
    Effect.gen(function* () {
      const job = yield* fromStore(
        "findJob",
        repository.findJob({
          id: input.id,
          organizationId: input.organizationId,
        })
      );
      if (Option.isNone(job)) {
        return yield* new DataImportNotFoundError({
          message: "No import with this id exists in this workspace.",
        });
      }
      const window = clampReportWindow(input.limit, input.offset);
      const report = yield* fromStore(
        "listRows",
        repository.listRows({
          jobId: input.id,
          limit: window.limit,
          offset: window.offset,
        })
      );
      return { job: job.value, report };
    }).pipe(Policy.withPolicy(canImportPosts(input.organizationId)));

  const listImports: DataImportServiceContract["listImports"] = (input) =>
    fromStore(
      "listJobs",
      repository.listJobs({
        limit: IMPORT_JOB_LIST_LIMIT,
        organizationId: input.organizationId,
      })
    ).pipe(Policy.withPolicy(canImportPosts(input.organizationId)));

  const watchImport: DataImportServiceContract["watchImport"] = (input) =>
    Stream.fromEffectSchedule(
      suppressInternalFailures(describeImport(input)),
      Schedule.spaced(DATA_IMPORT_WATCH_MS)
    ).pipe(
      Stream.filterMap(
        Filter.fromPredicateOption(
          (option: Option.Option<DataImportJobDetail>) => option
        )
      ),
      Stream.takeUntil((detail) => !statusIsActive(detail.job.status)),
      excludeUnchanged(reportChangeKey)
    );

  const watchImportList: DataImportServiceContract["watchImportList"] = (
    input
  ) =>
    Stream.fromEffectSchedule(
      suppressInternalFailures(
        listImports({ organizationId: input.organizationId })
      ),
      Schedule.spaced(DATA_IMPORT_WATCH_MS)
    ).pipe(
      Stream.filterMap(
        Filter.fromPredicateOption(
          (option: Option.Option<readonly DataImportJobRecord[]>) => option
        )
      ),
      excludeUnchanged((jobs) => jobs.map(jobChangeKey).join("\u0001"))
    );

  return {
    cancelImport,
    confirmImport,
    describeImport,
    listImports,
    stageBoardImport,
    watchImport,
    watchImportList,
  } satisfies DataImportServiceContract;
});

export class DataImportService extends Context.Service<
  DataImportService,
  DataImportServiceContract
>()("DataImportService", {
  make: makeDataImportService,
}) {
  static readonly layer = Layer.effect(this, this.make).pipe(
    Layer.provide(DataTransferRepository.layer),
    Layer.provide(BoardRepository.layer),
    Layer.provide(PostStatusRepository.layer)
  );
}

import { DataImportJobId, type LegidError } from "@feeblo/id";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

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
  DataTransferBoardNotFoundError,
  type DataTransferRepositoryError,
  InvalidBoardPostCsvError,
} from "./errors";
import { DATA_IMPORT_MAX_BYTES } from "./limits";
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
  readonly boardId: string;
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
    | DataTransferBoardNotFoundError
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

      const board = yield* boards
        .findByIdInOrganization({
          id: input.boardId,
          organizationId: input.organizationId,
        })
        .pipe(withRemapDbErrors("Board", "select"));
      if (Option.isNone(board)) {
        return yield* new DataTransferBoardNotFoundError({
          message: "No board with this id exists in this workspace.",
        });
      }

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
        board: { name: board.value.name, slug: board.value.slug },
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
          boardId: input.boardId,
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

  return {
    cancelImport,
    confirmImport,
    describeImport,
    listImports,
    stageBoardImport,
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

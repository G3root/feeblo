import {
  DataImportRowOutcome,
  DataImportStatus,
} from "@feeblo/domain-contracts/data-import";
import { DataImportJobId } from "@feeblo/id";
import * as S from "effect/Schema";

/** One staged job as the dashboard lists and describes it. */
export const DataImportJobSummary = S.Struct({
  id: S.String,
  status: DataImportStatus,
  fileName: S.String,
  /** File-level notices: unknown columns, new boards, a re-upload. */
  notices: S.Array(S.String),
  rowCount: S.Finite,
  createdCount: S.Finite,
  warningCount: S.Finite,
  errorCount: S.Finite,
  failureMessage: S.NullOr(S.String),
  createdAt: S.DateFromString,
  confirmedAt: S.NullOr(S.DateFromString),
  startedAt: S.NullOr(S.DateFromString),
  finishedAt: S.NullOr(S.DateFromString),
  /** When the retention sweep deletes the job and its row report. */
  retentionExpiresAt: S.DateFromString,
});

export type TDataImportJobSummary = S.Schema.Type<typeof DataImportJobSummary>;

/** One row of the report: what happened to row `rowNumber` of the file. */
export const DataImportReportRow = S.Struct({
  id: S.String,
  rowNumber: S.Finite,
  outcome: DataImportRowOutcome,
  /** A static field-scoped message; never a value copied from the file. */
  message: S.NullOr(S.String),
  postId: S.NullOr(S.String),
  /** The planned title, so a preview shows what confirming will create. */
  title: S.NullOr(S.String),
  /** The planned board name, or null for a row that failed before planning. */
  boardName: S.NullOr(S.String),
  /** The planned status display name. */
  statusName: S.NullOr(S.String),
  /** A bounded excerpt of the planned body; never the whole payload. */
  contentPreview: S.NullOr(S.String),
  /**
   * The post this row created, as the dashboard's route needs it: a board
   * slug and a post slug. Both are null until the worker creates the post.
   */
  boardSlug: S.NullOr(S.String),
  postSlug: S.NullOr(S.String),
  /**
   * The substitutions this row imports with: a defaulted status, an unreadable
   * eta, a dropped author email. Bounded at the repository so a long cell
   * cannot ride out of the payload; empty for a row that needs no attention.
   */
  warnings: S.Array(S.String),
});

export type TDataImportReportRow = S.Schema.Type<typeof DataImportReportRow>;

/**
 * The report filters the review page offers. Absent means every row. `warned`
 * is the one that is not an outcome: it selects rows whose plan carries a
 * substitution, whatever their lifecycle state.
 */
export const DataImportRowFilter = S.Literals([
  "failed",
  "warned",
  "pending",
  "created",
]);

export type TDataImportRowFilter = S.Schema.Type<typeof DataImportRowFilter>;

/** The one sortable column: the file's row order, either way. */
export const DataImportRowSort = S.Literals(["row_asc", "row_desc"]);

export type TDataImportRowSort = S.Schema.Type<typeof DataImportRowSort>;

/** Whole-job counts, independent of the filter the page is showing. */
export const DataImportReportCounts = S.Struct({
  total: S.Finite,
  pending: S.Finite,
  created: S.Finite,
  failed: S.Finite,
  /** Rows whose plan stores at least one substitution, any outcome. */
  warned: S.Finite,
});

export type TDataImportReportCounts = S.Schema.Type<
  typeof DataImportReportCounts
>;

/** One distinct failed-row message and how many rows carry it. */
export const DataImportFailureGroup = S.Struct({
  message: S.String,
  count: S.Finite,
});

export type TDataImportFailureGroup = S.Schema.Type<
  typeof DataImportFailureGroup
>;

/** One planned destination board and how many rows name it. */
export const DataImportBoardGroup = S.Struct({
  name: S.String,
  count: S.Finite,
});

export type TDataImportBoardGroup = S.Schema.Type<typeof DataImportBoardGroup>;

export const DataImportReportPage = S.Struct({
  rows: S.Array(DataImportReportRow),
  /** Rows matching the current filter, so pagination is honest. */
  total: S.Finite,
  counts: DataImportReportCounts,
  /** Failed rows grouped by their static message, most rows first. */
  failureGroups: S.Array(DataImportFailureGroup),
  /** Rows grouped by planned destination board, most rows first. */
  boardGroups: S.Array(DataImportBoardGroup),
});

export type TDataImportReportPage = S.Schema.Type<typeof DataImportReportPage>;

export const DataImportJobDetail = S.Struct({
  job: DataImportJobSummary,
  report: DataImportReportPage,
  /**
   * The boards a staged file will create, named once each. Empty once the job
   * leaves `awaiting_confirmation`, because by then the worker has created
   * them or is creating them.
   */
  newBoards: S.Array(S.String),
});

export type TDataImportJobDetail = S.Schema.Type<typeof DataImportJobDetail>;

export const DataImportList = S.Struct({
  organizationId: S.String,
});

export type TDataImportList = S.Schema.Type<typeof DataImportList>;

/**
 * A window bound: a whole, non-negative number of rows. Fractional or
 * negative values are rejected at the contract boundary so the service only
 * ever clamps a real request.
 */
const WindowBound = S.Int.check(S.isGreaterThanOrEqualTo(0));

const ReportWindow = {
  limit: S.optionalKey(WindowBound),
  offset: S.optionalKey(WindowBound),
};

/**
 * The report's narrowing. `message` matches a failed row's static message, so
 * a failure group links to the rows it counts; `board` matches the planned
 * destination board.
 */
const ReportFilter = {
  filter: S.optionalKey(DataImportRowFilter),
  board: S.optionalKey(S.String),
  message: S.optionalKey(S.String),
  sort: S.optionalKey(DataImportRowSort),
};

export const DataImportGet = S.Struct({
  id: DataImportJobId.schema,
  organizationId: S.String,
  ...ReportWindow,
  ...ReportFilter,
});

export type TDataImportGet = S.Schema.Type<typeof DataImportGet>;

export const DataImportConfirm = S.Struct({
  id: DataImportJobId.schema,
  organizationId: S.String,
});

export type TDataImportConfirm = S.Schema.Type<typeof DataImportConfirm>;

export const DataImportCancel = S.Struct({
  id: DataImportJobId.schema,
  organizationId: S.String,
});

export type TDataImportCancel = S.Schema.Type<typeof DataImportCancel>;

/** The row report download's query: the job is the path segment. */
export const DataImportProblemsQuery = S.Struct({
  organizationId: S.String,
});

export type TDataImportProblemsQuery = S.Schema.Type<
  typeof DataImportProblemsQuery
>;

/**
 * The export endpoint's query, as the wire carries it: query parameters are
 * strings, and the handler validates `includeArchived` so a malformed value
 * stays on the published error envelope. An absent `boardId` exports every
 * board in the workspace.
 */
export const PostExportQuery = S.Struct({
  organizationId: S.String,
  boardId: S.optionalKey(S.String),
  includeArchived: S.optionalKey(S.String),
});

export type TPostExportQuery = S.Schema.Type<typeof PostExportQuery>;

/** The multipart upload's non-file fields. */
export const DataImportUploadFields = {
  organizationId: S.String,
};

export const BOARD_IMPORT_DEFAULT_REPORT_LIMIT = 100;
export const BOARD_IMPORT_MAX_REPORT_LIMIT = 500;

import {
  DataImportRowOutcome,
  DataImportStatus,
} from "@feeblo/domain-contracts/data-import";
import { DataImportJobId } from "@feeblo/id";
import * as S from "effect/Schema";

/** One staged job as the dashboard lists and describes it. */
export const DataImportJobSummary = S.Struct({
  id: S.String,
  boardId: S.String,
  status: DataImportStatus,
  fileName: S.String,
  /** File-level notices: unknown columns, a differently named board, a re-upload. */
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
  /** The planned status display name. */
  statusName: S.NullOr(S.String),
  /** A bounded excerpt of the planned body; never the whole payload. */
  contentPreview: S.NullOr(S.String),
});

export type TDataImportReportRow = S.Schema.Type<typeof DataImportReportRow>;

export const DataImportReportPage = S.Struct({
  rows: S.Array(DataImportReportRow),
  total: S.Finite,
});

export type TDataImportReportPage = S.Schema.Type<typeof DataImportReportPage>;

export const DataImportJobDetail = S.Struct({
  job: DataImportJobSummary,
  report: DataImportReportPage,
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

export const DataImportGet = S.Struct({
  id: DataImportJobId.schema,
  organizationId: S.String,
  ...ReportWindow,
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

/**
 * The export endpoint's query, as the wire carries it: query parameters are
 * strings, and the handler validates `includeArchived` so a malformed value
 * stays on the published error envelope.
 */
export const BoardExportQuery = S.Struct({
  organizationId: S.String,
  boardId: S.String,
  includeArchived: S.optionalKey(S.String),
});

export type TBoardExportQuery = S.Schema.Type<typeof BoardExportQuery>;

/** The multipart upload's non-file fields. */
export const BoardImportUploadFields = {
  organizationId: S.String,
  boardId: S.String,
};

export const BOARD_IMPORT_DEFAULT_REPORT_LIMIT = 100;
export const BOARD_IMPORT_MAX_REPORT_LIMIT = 500;

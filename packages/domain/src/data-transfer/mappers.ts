import type { DataImportJobDetail } from "./import-service";
import type { DataImportJobRecord, DataImportRowRecord } from "./repository";
import type {
  TDataImportJobDetail,
  TDataImportJobSummary,
  TDataImportReportRow,
} from "./schema";

/**
 * Narrowing a stored job to the published summary.
 *
 * Field by field on purpose: a column added to `data_import_job` must not ride
 * into an RPC or HTTP response because a spread happened to carry it. The same
 * rule the Public API's mappers follow (see `docs/adr/0004`).
 */
export const toDataImportJobSummary = (
  job: DataImportJobRecord
): TDataImportJobSummary => ({
  confirmedAt: job.confirmedAt,
  createdAt: job.createdAt,
  createdCount: job.createdCount,
  errorCount: job.errorCount,
  failureMessage: job.failureMessage,
  fileName: job.fileName,
  finishedAt: job.finishedAt,
  id: job.id,
  notices: [...job.notices],
  rowCount: job.rowCount,
  startedAt: job.startedAt,
  status: job.status,
  warningCount: job.warningCount,
});

export const toDataImportReportRow = (
  row: DataImportRowRecord
): TDataImportReportRow => ({
  boardName: row.boardName,
  contentPreview: row.contentPreview,
  id: row.id,
  message: row.message,
  outcome: row.outcome,
  postId: row.postId,
  rowNumber: row.rowNumber,
  statusName: row.statusName,
  title: row.title,
});

export const toDataImportJobDetail = (
  detail: DataImportJobDetail
): TDataImportJobDetail => ({
  job: toDataImportJobSummary(detail.job),
  report: {
    rows: detail.report.rows.map(toDataImportReportRow),
    total: detail.report.total,
  },
});

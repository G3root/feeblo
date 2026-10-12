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
  retentionExpiresAt: job.retentionExpiresAt,
  rowCount: job.rowCount,
  startedAt: job.startedAt,
  status: job.status,
  warningCount: job.warningCount,
});

export const toDataImportReportRow = (
  row: DataImportRowRecord
): TDataImportReportRow => ({
  boardName: row.boardName,
  boardSlug: row.boardSlug,
  contentPreview: row.contentPreview,
  id: row.id,
  message: row.message,
  outcome: row.outcome,
  postId: row.postId,
  postSlug: row.postSlug,
  rowNumber: row.rowNumber,
  statusName: row.statusName,
  title: row.title,
  warnings: [...row.warnings],
});

export const toDataImportJobDetail = (
  detail: DataImportJobDetail
): TDataImportJobDetail => ({
  job: toDataImportJobSummary(detail.job),
  newBoards: [...detail.newBoards],
  report: {
    boardGroups: detail.report.boardGroups.map((group) => ({ ...group })),
    counts: { ...detail.report.counts },
    failureGroups: detail.report.failureGroups.map((group) => ({ ...group })),
    rows: detail.report.rows.map(toDataImportReportRow),
    total: detail.report.total,
  },
});

import type { TDataImportJobSummary } from "@feeblo/domain/data-transfer/schema";

import { m } from "@/paraglide/messages.js";

/** The one place a job status becomes a sentence. */
const STATUS_LABELS = {
  awaiting_confirmation: m.sunny_brave_mink,
  canceled: m.lucid_mellow_bass,
  completed: m.amber_kind_gecko,
  failed: m.rustic_young_stork,
  queued: m.tidy_eager_quail,
  running: m.swift_bold_finch,
} satisfies Record<TDataImportJobSummary["status"], () => string>;

export const statusLabel = (status: TDataImportJobSummary["status"]): string =>
  STATUS_LABELS[status]();

/** The badge treatment a status gets, so it reads the same everywhere. */
const STATUS_VARIANTS = {
  awaiting_confirmation: "secondary",
  canceled: "secondary",
  completed: "default",
  failed: "destructive",
  queued: "outline",
  running: "outline",
} satisfies Record<
  TDataImportJobSummary["status"],
  "default" | "secondary" | "destructive" | "outline"
>;

export const statusBadgeVariant = (
  status: TDataImportJobSummary["status"]
): "default" | "secondary" | "destructive" | "outline" =>
  STATUS_VARIANTS[status];

/** The states in which a staged import still occupies its workspace. */
export const isActiveStatus = (
  status: TDataImportJobSummary["status"]
): boolean =>
  status === "awaiting_confirmation" ||
  status === "queued" ||
  status === "running";

/** Rows that will become posts when the staged job is confirmed. */
export const plannedRowCount = (job: TDataImportJobSummary): number =>
  Math.max(0, job.rowCount - job.errorCount);

/**
 * How far a run has got, as a whole percent. A row that failed still counts as
 * processed: the progress bar tracks the pass, not the outcome.
 */
export const progressPercent = (job: TDataImportJobSummary): number => {
  if (job.rowCount === 0) {
    return 0;
  }
  const processed = job.createdCount + job.errorCount;
  return Math.max(
    0,
    Math.min(100, Math.round((processed / job.rowCount) * 100))
  );
};

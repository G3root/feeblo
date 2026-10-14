import type { TDataImportJobSummary } from "@feeblo/domain/data-transfer/schema";
import { Badge } from "@feeblo/ui/badge";
import {
  Progress,
  ProgressIndicator,
  ProgressTrack,
  ProgressValue,
} from "@feeblo/ui/progress";
import { cn } from "@feeblo/ui/utils";

import { m } from "@/paraglide/messages.js";

import { progressPercent, statusBadgeVariant, statusLabel } from "../format";

/** The status pill, so a job reads the same on every surface. */
export function ImportStatusBadge({
  status,
}: {
  readonly status: TDataImportJobSummary["status"];
}) {
  return (
    <Badge variant={statusBadgeVariant(status)}>{statusLabel(status)}</Badge>
  );
}

/** One number of an import review and what it counts. */
export function ImportStat({
  label,
  tone = "default",
  value,
}: {
  readonly label: string;
  readonly tone?: "default" | "destructive" | "warning";
  readonly value: number;
}) {
  return (
    <div className="bg-muted/20 rounded-lg border px-3 py-2">
      <p
        className={cn(
          "text-lg font-semibold tabular-nums",
          tone === "warning" && "text-warning-foreground",
          tone === "destructive" && "text-destructive"
        )}
      >
        {value}
      </p>
      <p className="text-muted-foreground text-xs">{label}</p>
    </div>
  );
}

/**
 * A live run's progress. The worker moves rows in batches, so the bar tracks
 * rows the pass has finished, failed included; the caption names the count
 * the dashboard's watch stream is reporting right now.
 */
export function ImportProgressBar({
  job,
}: {
  readonly job: TDataImportJobSummary;
}) {
  const percent = progressPercent(job);
  return (
    <Progress value={percent}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{statusLabel(job.status)}</p>
        <ProgressValue>{() => `${percent}%`}</ProgressValue>
      </div>
      <ProgressTrack>
        <ProgressIndicator />
      </ProgressTrack>
      <p className="text-muted-foreground text-xs">
        {m.sunny_bold_wren({ created: job.createdCount, total: job.rowCount })}
      </p>
    </Progress>
  );
}

/**
 * The Result column: what a job has produced, or where it is. A staged job has
 * no result yet, and a finished one keeps its error and warning counts next to
 * the posts it made.
 */
export function ImportResultText({
  job,
}: {
  readonly job: TDataImportJobSummary;
}) {
  if (job.status === "awaiting_confirmation") {
    return <span>—</span>;
  }
  if (job.status === "queued") {
    return <span>{statusLabel(job.status)}</span>;
  }
  if (job.status === "running") {
    return (
      <span className="tabular-nums">
        {m.sunny_bold_wren({ created: job.createdCount, total: job.rowCount })}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {m.witty_loyal_bee({
        created: job.createdCount,
        errors: job.errorCount,
        warnings: job.warningCount,
      })}
    </span>
  );
}

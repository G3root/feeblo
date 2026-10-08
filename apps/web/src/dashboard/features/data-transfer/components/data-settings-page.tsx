import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { BOARD_POST_CSV_TEMPLATE } from "@feeblo/domain-contracts/board-csv";
import {
  DataImportJobSummary,
  type TDataImportJobDetail,
  type TDataImportJobSummary,
} from "@feeblo/domain/data-transfer/schema";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from "@feeblo/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@feeblo/ui/field";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import {
  SwitchCard,
  SwitchCardInput,
  SwitchCardTitle,
} from "@feeblo/ui/switch-card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import * as dayjs from "@feeblo/utils/dayjs";
import { isPlainObject, isString } from "@feeblo/utils/runtime-kind";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  Cancel01Icon,
  FileDownloadIcon,
  FileSpreadsheetIcon,
  FileUploadIcon,
  InboxDownloadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";
import { useMemo, useState } from "react";

import { m } from "@/paraglide/messages.js";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";

import {
  cancelDataImportAtom,
  confirmDataImportAtom,
  type DataImportDetailArgs,
  dataImportDetailAtom,
  dataImportJobsAtom,
  type DataTransferBoard,
  dataTransferBoardsAtom,
} from "../atoms";

/** Report rows one page shows; the RPC clamps whatever the client sends. */
const REPORT_PAGE_SIZE = 100;

const statusLabel = (status: TDataImportJobSummary["status"]): string => {
  switch (status) {
    case "awaiting_confirmation":
      return m.sunny_brave_mink();
    case "queued":
      return m.tidy_eager_quail();
    case "running":
      return m.swift_bold_finch();
    case "completed":
      return m.amber_kind_gecko();
    case "failed":
      return m.rustic_young_stork();
    case "canceled":
      return m.lucid_mellow_bass();
  }
};

const statusVariant = (
  status: TDataImportJobSummary["status"]
): "default" | "secondary" | "destructive" | "outline" => {
  switch (status) {
    case "completed":
      return "default";
    case "failed":
      return "destructive";
    case "running":
    case "queued":
      return "outline";
    default:
      return "secondary";
  }
};

/** The states in which a staged import still occupies its workspace. */
const statusIsActive = (status: TDataImportJobSummary["status"]): boolean =>
  status === "awaiting_confirmation" ||
  status === "queued" ||
  status === "running";

/** Rows that will become posts when the staged job is confirmed. */
const readyRowCount = (job: TDataImportJobSummary): number =>
  Math.max(0, job.rowCount - job.errorCount);

/**
 * Writes the download the importer accepts. The template comes from the same
 * contract the server parses, so a column the parser stops reading cannot
 * stay in a file the dashboard hands out.
 */
const downloadImportTemplate = () => {
  const blob = new Blob([BOARD_POST_CSV_TEMPLATE], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = "board-import-template.csv";
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
};

/**
 * The boards either transfer names, kept as one read for both pickers. The
 * atom is a family, so the second card reads the same query the first one
 * mounted.
 */
function useTransferBoards(organizationId: string) {
  const boardsResult = useAtomValue(dataTransferBoardsAtom(organizationId));
  const boards = Result.builder(boardsResult)
    .onInitial(
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      () => [] as readonly DataTransferBoard[]
    )
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        onNone: () => [] as readonly DataTransferBoard[],
        onSome: ({ value }) => value,
      })
    )
    .onSuccess((value) => value)
    .exhaustive();

  return { boards, isLoading: Result.isInitial(boardsResult) };
}

function BoardPicker({
  disabled = false,
  onChange,
  organizationId,
  placeholder,
  value,
}: {
  readonly disabled?: boolean;
  readonly onChange: (boardId: string) => void;
  readonly organizationId: string;
  readonly placeholder: string;
  readonly value: string;
}) {
  const { boards, isLoading } = useTransferBoards(organizationId);
  const items = boards.map((board) => ({
    label: board.name,
    value: board.id,
  }));

  return (
    <Field>
      <FieldLabel>{m.brave_lucky_newt()}</FieldLabel>
      <Select
        disabled={disabled}
        items={items}
        onValueChange={(next) => onChange(next ?? "")}
        value={value === "" ? null : value}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectPopup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
      {boards.length === 0 && !isLoading ? (
        <FieldDescription>{m.basic_alert_boar()}</FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * The upload surface: one dashed target that accepts a click or a drop. The
 * board choice and the upload stay separate on purpose — a file is read only
 * when the person presses Upload, so dropping the wrong file costs nothing.
 */
function ImportDropzone({
  disabled,
  file,
  onFileChange,
}: {
  readonly disabled: boolean;
  readonly file: File | null;
  readonly onFileChange: (file: File | null) => void;
}) {
  const [isDragging, setIsDragging] = useState(false);

  return (
    <label
      className={cn(
        "border-border/70 bg-muted/20 focus-within:ring-ring/24 hover:bg-muted/40 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors focus-within:ring-[3px]",
        isDragging && "border-primary/60 bg-muted/60",
        disabled && "pointer-events-none opacity-64"
      )}
      onDragLeave={() => setIsDragging(false)}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setIsDragging(false);
        onFileChange(event.dataTransfer.files[0] ?? null);
      }}
    >
      <HugeiconsIcon
        className="text-muted-foreground size-6"
        icon={file === null ? FileUploadIcon : FileSpreadsheetIcon}
      />
      {file === null ? (
        <>
          <span className="text-sm font-medium">{m.tidy_clear_wren()}</span>
          <span className="text-muted-foreground max-w-sm text-xs">
            {m.warm_clear_newt()}
          </span>
        </>
      ) : (
        <span className="flex max-w-full items-center gap-2">
          <span className="truncate text-sm font-medium">{file.name}</span>
          <Button
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onFileChange(null);
            }}
            size="xs"
            type="button"
            variant="ghost"
          >
            {m.kind_cool_bass()}
          </Button>
        </span>
      )}
      <input
        accept=".csv,text/csv"
        aria-label={m.keen_calm_swan()}
        className="sr-only"
        disabled={disabled}
        onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        type="file"
      />
    </label>
  );
}

/** One number of the upload review and what it counts. */
function ReviewStat({
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
 * Import, review, confirm. The server stages every row before anything is
 * written, so this panel is the preview the existing flow promised: the
 * counts and notices are the staged job's, and Confirm is the only action
 * that writes a post.
 */
function ImportCard({
  busyJobId,
  onCancel,
  onConfirm,
  onSelectJob,
  organizationId,
}: {
  readonly busyJobId: string | null;
  readonly onCancel: (job: TDataImportJobSummary) => Promise<boolean>;
  readonly onConfirm: (job: TDataImportJobSummary) => Promise<boolean>;
  readonly onSelectJob: (jobId: string) => void;
  readonly organizationId: string;
}) {
  const apiUrl = getRuntimePublicEnv().apiUrl;
  const [boardId, setBoardId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [pendingJob, setPendingJob] = useState<TDataImportJobSummary | null>(
    null
  );

  const messageFromResponse = async (
    response: Response
  ): Promise<string | null> => {
    const payload: unknown = await response.json().catch(() => null);
    return isPlainObject(payload) &&
      Predicate.hasProperty(payload, "message") &&
      isString(payload.message)
      ? payload.message
      : null;
  };

  const handleUpload = async () => {
    if (file === null || boardId === "") {
      return;
    }
    setIsUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("boardId", boardId);
      body.append("organizationId", organizationId);
      const response = await fetch(`${apiUrl}/api/data/import`, {
        body,
        credentials: "include",
        method: "POST",
      });
      if (!response.ok) {
        // 409 is the workspace's slot being taken, which reads better as the
        // reserved conflict message; anything else shows the server's own
        // explanation (an unknown status, the row limit) when it has one.
        const title =
          response.status === 409
            ? m.grand_plain_moose()
            : ((await messageFromResponse(response)) ?? m.solid_calm_cub());
        toastManager.add({ title, type: "error" });
        return;
      }
      const payload: unknown = await response.json();
      // SAFETY: The endpoint contract returns a DataImportJobSummary; the
      // schema rejects drift instead of leaking it into the review panel. This
      // is a React event handler, not Effect code: the Option is the recovery.
      // eslint-disable-next-line effecttsgo/schema-sync -- non-Effect React boundary
      const decoded = Schema.decodeUnknownOption(DataImportJobSummary)(payload);
      if (Option.isNone(decoded)) {
        toastManager.add({ title: m.tidy_bold_yak(), type: "error" });
        return;
      }
      setPendingJob(decoded.value);
      setFile(null);
    } catch {
      toastManager.add({ title: m.tidy_bold_yak(), type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  const handleConfirm = async () => {
    if (pendingJob === null) {
      return;
    }
    if (await onConfirm(pendingJob)) {
      onSelectJob(pendingJob.id);
      setPendingJob(null);
    }
  };

  const handleDiscard = async () => {
    if (pendingJob === null) {
      return;
    }
    if (await onCancel(pendingJob)) {
      setPendingJob(null);
    }
  };

  const readyCount = pendingJob === null ? 0 : readyRowCount(pendingJob);

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{m.noble_sunny_crow()}</CardTitle>
        <CardDescription>{m.proud_witty_fox()}</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-1 flex-col gap-4">
        <div className="border-border/70 bg-muted/20 flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
          <p className="text-muted-foreground text-xs">{m.kind_bold_moth()}</p>
          <Button
            onClick={downloadImportTemplate}
            size="sm"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon icon={FileDownloadIcon} />
            {m.sunny_plain_heron()}
          </Button>
        </div>

        {pendingJob === null ? (
          <>
            <BoardPicker
              disabled={isUploading}
              onChange={setBoardId}
              organizationId={organizationId}
              placeholder={m.swift_calm_bass()}
              value={boardId}
            />
            <ImportDropzone
              disabled={isUploading}
              file={file}
              onFileChange={setFile}
            />
            <p className="text-muted-foreground text-xs">
              {m.sturdy_bold_crab()}
            </p>
          </>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-2">
                <HugeiconsIcon
                  className="text-muted-foreground size-4.5 shrink-0"
                  icon={FileSpreadsheetIcon}
                />
                <span className="truncate text-sm font-medium">
                  {pendingJob.fileName}
                </span>
              </span>
              <Badge variant="secondary">
                {statusLabel(pendingJob.status)}
              </Badge>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <ReviewStat label={m.bold_fresh_puma()} value={readyCount} />
              <ReviewStat
                label={m.gentle_smart_auk()}
                tone="warning"
                value={pendingJob.warningCount}
              />
              <ReviewStat
                label={m.rustic_young_stork()}
                tone="destructive"
                value={pendingJob.errorCount}
              />
            </div>
            {pendingJob.notices.length > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  {m.humble_sleek_carp()}
                </span>
                {pendingJob.notices.map((notice) => (
                  <p className="text-muted-foreground text-xs" key={notice}>
                    {notice}
                  </p>
                ))}
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busyJobId === pendingJob.id}
                onClick={() => {
                  void handleConfirm();
                }}
                type="button"
              >
                {m.zesty_fresh_mole({ count: readyCount })}
              </Button>
              <Button
                onClick={() => onSelectJob(pendingJob.id)}
                type="button"
                variant="outline"
              >
                {m.fresh_bold_gecko()}
              </Button>
              <Button
                disabled={busyJobId === pendingJob.id}
                onClick={() => {
                  void handleDiscard();
                }}
                type="button"
                variant="ghost"
              >
                {m.crisp_honest_wren()}
              </Button>
            </div>
          </div>
        )}
      </CardPanel>
      {pendingJob === null ? (
        <CardFooter className="justify-end">
          <Button
            disabled={file === null || boardId === "" || isUploading}
            onClick={() => {
              void handleUpload();
            }}
            type="button"
          >
            {isUploading ? m.calm_sharp_bass() : m.warm_wise_toad()}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** One board out of the workspace, as CSV, through the HTTP download route. */
function ExportCard({ organizationId }: { readonly organizationId: string }) {
  const apiUrl = getRuntimePublicEnv().apiUrl;
  const [boardId, setBoardId] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);

  const handleExport = () => {
    if (boardId === "") {
      return;
    }
    const url = new URL(`${apiUrl}/api/data/export`);
    url.searchParams.set("organizationId", organizationId);
    url.searchParams.set("boardId", boardId);
    if (includeArchived) {
      url.searchParams.set("includeArchived", "true");
    }
    window.location.assign(url.toString());
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{m.eager_plain_crab()}</CardTitle>
        <CardDescription>{m.gentle_happy_moth()}</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-1 flex-col gap-4">
        <BoardPicker
          onChange={setBoardId}
          organizationId={organizationId}
          placeholder={m.swift_calm_bass()}
          value={boardId}
        />
        <SwitchCard variant="outline">
          <SwitchCardTitle>{m.lively_green_ibex()}</SwitchCardTitle>
          <SwitchCardInput
            checked={includeArchived}
            onCheckedChange={setIncludeArchived}
          />
        </SwitchCard>
      </CardPanel>
      <CardFooter>
        <Button disabled={boardId === ""} onClick={handleExport} type="button">
          {m.merry_quiet_koi()}
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * Every upload and what it is doing, newest first. The list is a watch
 * stream, so a confirm or a worker pass updates the statuses and counters
 * without this card asking again.
 */
function RecentImportsCard({
  busyJobId,
  onConfirm,
  onSelectJob,
  organizationId,
}: {
  readonly busyJobId: string | null;
  readonly onConfirm: (job: TDataImportJobSummary) => Promise<boolean>;
  readonly onSelectJob: (jobId: string) => void;
  readonly organizationId: string;
}) {
  const jobsResult = useAtomValue(dataImportJobsAtom(organizationId));
  const jobs = Result.builder(jobsResult)
    .onInitial(
      // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
      () => [] as readonly TDataImportJobSummary[]
    )
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        // SAFETY: Empty-state placeholder: an empty collection is valid until real data resolves.
        onNone: () => [] as readonly TDataImportJobSummary[],
        onSome: ({ value }) => value,
      })
    )
    .onSuccess((value) => value)
    .exhaustive();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.vivid_steady_hare()}</CardTitle>
        <CardDescription>{m.eager_calm_dove()}</CardDescription>
      </CardHeader>
      <CardPanel>
        {jobs.length === 0 ? (
          <Empty className="py-8 md:py-10">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <HugeiconsIcon icon={InboxDownloadIcon} />
              </EmptyMedia>
              <EmptyTitle>{m.plain_gentle_robin()}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.keen_calm_swan()}</TableHead>
                <TableHead>{m.soft_calm_mouse()}</TableHead>
                <TableHead>{m.sunny_swift_newt()}</TableHead>
                <TableHead>{m.proud_gentle_swan()}</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">{m.brave_quick_auk()}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell
                    className="max-w-[240px] truncate"
                    title={job.fileName}
                  >
                    {job.fileName}
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(job.status)}>
                      {statusLabel(job.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {job.status === "awaiting_confirmation"
                      ? "—"
                      : m.witty_loyal_bee({
                          created: job.createdCount,
                          errors: job.errorCount,
                          warnings: job.warningCount,
                        })}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dayjs.default(job.createdAt).format("MMM D, YYYY")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {job.status === "awaiting_confirmation" ? (
                        <Button
                          disabled={busyJobId === job.id}
                          onClick={() => {
                            void onConfirm(job);
                          }}
                          size="sm"
                          type="button"
                        >
                          {m.zesty_fresh_mole({
                            count: readyRowCount(job),
                          })}
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => onSelectJob(job.id)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {m.fresh_bold_gecko()}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardPanel>
    </Card>
  );
}

/**
 * One job's report, page by page. The watch stream follows the job until it
 * is terminal, so the counters and the visible rows update in place; a page
 * change moves the atom to that page's own watcher.
 */
function ImportDetailCard({
  busyJobId,
  id,
  onCancel,
  onClose,
  onConfirm,
  onPageChange,
  organizationId,
  page,
}: {
  readonly busyJobId: string | null;
  readonly id: string;
  readonly onCancel: (job: TDataImportJobSummary) => Promise<boolean>;
  readonly onClose: () => void;
  readonly onConfirm: (job: TDataImportJobSummary) => Promise<boolean>;
  readonly onPageChange: (page: number) => void;
  readonly organizationId: string;
  readonly page: number;
}) {
  const args = useMemo(
    (): DataImportDetailArgs => ({
      id,
      limit: REPORT_PAGE_SIZE,
      offset: page * REPORT_PAGE_SIZE,
      organizationId,
    }),
    [id, organizationId, page]
  );
  const detailResult = useAtomValue(dataImportDetailAtom(args));
  const detail: TDataImportJobDetail | undefined = Result.builder(detailResult)
    .onInitial(() => undefined)
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => undefined,
        onSome: ({ value }) => value,
      })
    )
    .onSuccess((value) => value)
    .exhaustive();

  if (detail === undefined) {
    return null;
  }

  const job = detail.job;
  const reportTotal = detail.report.total;
  const reportPages = Math.max(1, Math.ceil(reportTotal / REPORT_PAGE_SIZE));
  const reportFrom = reportTotal === 0 ? 0 : page * REPORT_PAGE_SIZE + 1;
  const reportTo = Math.min(reportTotal, (page + 1) * REPORT_PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.agile_bright_auk()}</CardTitle>
        <CardDescription>
          {job.fileName} ·{" "}
          {job.failureMessage ??
            (job.status === "failed"
              ? m.sunny_mild_puma()
              : statusLabel(job.status))}
        </CardDescription>
        <CardAction>
          <div className="flex items-center gap-2">
            {job.status === "awaiting_confirmation" ? (
              <Button
                disabled={busyJobId === job.id}
                onClick={() => {
                  void onConfirm(job);
                }}
                size="sm"
                type="button"
              >
                {m.zesty_fresh_mole({ count: readyRowCount(job) })}
              </Button>
            ) : null}
            {statusIsActive(job.status) ? (
              <Button
                disabled={busyJobId === job.id}
                onClick={() => {
                  void onCancel(job);
                }}
                size="sm"
                type="button"
                variant="outline"
              >
                {m.crisp_honest_wren()}
              </Button>
            ) : null}
            <Button
              aria-label={m.cool_plain_auk()}
              onClick={onClose}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={Cancel01Icon} />
            </Button>
          </div>
        </CardAction>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        {job.notices.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{m.humble_sleek_carp()}</span>
            {job.notices.map((notice) => (
              <p className="text-muted-foreground text-xs" key={notice}>
                {notice}
              </p>
            ))}
          </div>
        ) : null}
        {detail.report.rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {m.breezy_quiet_loon()}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.calm_crisp_newt()}</TableHead>
                <TableHead>{m.keen_bold_kite()}</TableHead>
                <TableHead>{m.soft_calm_mouse()}</TableHead>
                <TableHead>{m.fresh_plain_bass()}</TableHead>
                <TableHead>{m.vivid_calm_newt()}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.report.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {m.quick_plain_dove({ row: row.rowNumber })}
                  </TableCell>
                  <TableCell>{row.title ?? ""}</TableCell>
                  <TableCell>{row.statusName ?? ""}</TableCell>
                  <TableCell className="max-w-md whitespace-pre-wrap">
                    {row.contentPreview ?? ""}
                  </TableCell>
                  <TableCell>
                    {row.message ??
                      (row.outcome === "created" ? "" : row.outcome)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {reportTotal > REPORT_PAGE_SIZE ? (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {m.warm_lucky_toad({
                from: reportFrom,
                to: reportTo,
                total: reportTotal,
              })}
            </span>
            <div className="flex gap-2">
              <Button
                disabled={page === 0}
                onClick={() => onPageChange(page - 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                {m.calm_brisk_auk()}
              </Button>
              <Button
                disabled={page + 1 >= reportPages}
                onClick={() => onPageChange(page + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                {m.brave_plain_lark()}
              </Button>
            </div>
          </div>
        ) : null}
      </CardPanel>
    </Card>
  );
}

export function DataSettingsPage() {
  const organizationId = useOrganizationId();
  const { allowed: canImport, isPending: importPolicyPending } = usePolicy(
    hasPermission(organizationId, "boards.importPosts")
  );
  const { allowed: canExport, isPending: exportPolicyPending } = usePolicy(
    hasPermission(organizationId, "boards.exportData")
  );
  const confirmImport = useAtomSet(confirmDataImportAtom, { mode: "promise" });
  const cancelImport = useAtomSet(cancelDataImportAtom, { mode: "promise" });
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [reportPage, setReportPage] = useState(0);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const showImport = canImport && !importPolicyPending;
  const showExport = canExport && !exportPolicyPending;

  const selectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setReportPage(0);
  };

  const handleConfirm = async (
    job: TDataImportJobSummary
  ): Promise<boolean> => {
    setBusyJobId(job.id);
    try {
      await confirmImport({ payload: { id: job.id, organizationId } });
      return true;
    } catch {
      toastManager.add({ title: m.lucky_plain_gull(), type: "error" });
      return false;
    } finally {
      setBusyJobId(null);
    }
  };

  const handleCancel = async (job: TDataImportJobSummary): Promise<boolean> => {
    setBusyJobId(job.id);
    try {
      await cancelImport({ payload: { id: job.id, organizationId } });
      return true;
    } catch {
      toastManager.add({ title: m.merry_plain_auk(), type: "error" });
      return false;
    } finally {
      setBusyJobId(null);
    }
  };

  return (
    <SettingsLayout.Root size="large">
      <SettingsLayout.Header>
        <SettingsLayout.HeaderTitle>
          {m.bright_keen_heron()}
        </SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription>
          {m.calm_smart_lark()}
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>

      <SettingsLayout.Content>
        <div
          className={cn(
            "grid gap-6",
            showImport && showExport && "lg:grid-cols-2"
          )}
        >
          {showImport ? (
            <ImportCard
              busyJobId={busyJobId}
              onCancel={handleCancel}
              onConfirm={handleConfirm}
              onSelectJob={selectJob}
              organizationId={organizationId}
            />
          ) : null}
          {showExport ? <ExportCard organizationId={organizationId} /> : null}
        </div>

        {showImport ? (
          <RecentImportsCard
            busyJobId={busyJobId}
            onConfirm={handleConfirm}
            onSelectJob={selectJob}
            organizationId={organizationId}
          />
        ) : null}

        {showImport && selectedJobId !== null ? (
          <ImportDetailCard
            busyJobId={busyJobId}
            id={selectedJobId}
            onCancel={handleCancel}
            onClose={() => {
              setSelectedJobId(null);
              setReportPage(0);
            }}
            onConfirm={handleConfirm}
            onPageChange={setReportPage}
            organizationId={organizationId}
            page={reportPage}
          />
        ) : null}
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

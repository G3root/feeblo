import { useAtomSet, useAtomValue } from "@effect/atom-react";
import {
  BOARD_POST_CSV_COLUMNS,
  BOARD_POST_CSV_TEMPLATE,
} from "@feeblo/domain-contracts/board-csv";
import { DATA_IMPORT_MAX_BYTES } from "@feeblo/domain/data-transfer/limits";
import {
  DataImportJobSummary,
  type TDataImportJobSummary,
} from "@feeblo/domain/data-transfer/schema";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@feeblo/ui/alert";
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
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@feeblo/ui/collapsible";
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
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import {
  ArrowDown01Icon,
  FileDownloadIcon,
  FileSpreadsheetIcon,
  FileUploadIcon,
  InboxDownloadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Result from "effect/reactivity/AsyncResult";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { m } from "@/paraglide/messages.js";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";

import {
  dataTransferApiBase,
  downloadBlob,
  downloadResponse,
  errorEnvelopeMessage,
} from "../api";
import {
  cancelDataImportAtom,
  dataImportJobsAtom,
  dataTransferBoardsAtom,
  type DataTransferBoard,
} from "../atoms";
import { isActiveStatus, plannedRowCount } from "../format";
import { CancelImportDialog } from "./import-dialogs";
import {
  ImportProgressBar,
  ImportResultText,
  ImportStat,
  ImportStatusBadge,
} from "./import-status";

/** The export picker's sentinel for "every board"; never a real board id. */
const ALL_BOARDS = "__all_boards__";

/**
 * Writes the download the importer accepts. The template comes from the same
 * contract the server parses, so a column the parser stops reading cannot
 * stay in a file the dashboard hands out.
 */
const downloadImportTemplate = () => {
  downloadBlob(
    new Blob([BOARD_POST_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }),
    "board-import-template.csv"
  );
};

/**
 * Matches the export's server-side name: `<board-slug>-posts-<UTC date>.csv`,
 * or `posts-<UTC date>.csv` for the whole workspace.
 */
const fallbackExportFileName = (
  boards: readonly DataTransferBoard[],
  boardId: string | null
): string => {
  const date = new Date().toISOString().slice(0, 10);
  if (boardId === null) {
    return `posts-${date}.csv`;
  }
  const slug = boards.find((board) => board.id === boardId)?.slug ?? "posts";
  return `${slug}-posts-${date}.csv`;
};

/**
 * The boards the export picker names, read once for the card. The atom is a
 * family, so the picker and the fallback filename read the same query.
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

/** The workspace's import jobs, newest first, from the live watch stream. */
function useTransferJobs(organizationId: string) {
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

  return jobs;
}

function BoardPicker({
  disabled = false,
  onChange,
  organizationId,
  value,
}: {
  readonly disabled?: boolean;
  readonly onChange: (boardId: string) => void;
  readonly organizationId: string;
  readonly value: string;
}) {
  const { boards, isLoading } = useTransferBoards(organizationId);
  const items = [
    { label: m.leafy_calm_jay(), value: ALL_BOARDS },
    ...boards.map((board) => ({ label: board.name, value: board.id })),
  ];

  return (
    <Field>
      <FieldLabel>{m.brave_lucky_newt()}</FieldLabel>
      <Select
        disabled={disabled}
        items={items}
        onValueChange={(next) => onChange(next ?? ALL_BOARDS)}
        value={value === "" ? null : value}
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder={m.swift_calm_bass()} />
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
 * bytes are read only when the person presses Upload, so dropping the wrong
 * file costs nothing. There is no board choice: the file's `board` column
 * routes every row and missing boards are created when the import runs.
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

  const reject = (title: string) => {
    toastManager.add({ title, type: "error" });
  };
  const accept = (candidate: File | null) => {
    if (candidate === null) {
      onFileChange(null);
      return;
    }
    // The server holds the same limits; checking here turns a round trip into
    // an immediate sentence about the file the person just picked.
    if (!/\.csv$/iu.test(candidate.name)) {
      reject(m.quiet_fresh_moth());
      return;
    }
    if (candidate.size > DATA_IMPORT_MAX_BYTES) {
      reject(m.brave_calm_kite());
      return;
    }
    onFileChange(candidate);
  };

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
        accept(event.dataTransfer.files[0] ?? null);
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
        onChange={(event) => accept(event.target.files?.[0] ?? null)}
        type="file"
      />
    </label>
  );
}

/** The column contract, one badge per column, with what each one does. */
function TemplateGuide() {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium data-panel-open:[&_svg]:rotate-180">
        <span>{m.soft_bold_wren()}</span>
        <HugeiconsIcon
          className="size-4 transition-transform"
          icon={ArrowDown01Icon}
        />
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 px-3 pt-3">
          <div className="flex flex-wrap gap-1">
            {BOARD_POST_CSV_COLUMNS.map((column) => (
              <Badge key={column} variant="outline">
                {column}
              </Badge>
            ))}
          </div>
          <p className="text-muted-foreground text-xs">{m.lucky_kind_auk()}</p>
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
}

/**
 * Import, review, confirm. The server stages every row before anything is
 * written, so the card shows the staged job's counts and notices, and the
 * review page is where a person reads the rows and confirms.
 *
 * The active job is read from the live list, not from this component's own
 * state, so the card survives a reload and a second tab sees the same gate.
 */
function ImportCard({
  activeJob,
  busyJobId,
  onCancel,
  onStaged,
  organizationId,
}: {
  readonly activeJob: TDataImportJobSummary | null;
  readonly busyJobId: string | null;
  readonly onCancel: (job: TDataImportJobSummary) => void;
  readonly onStaged: (job: TDataImportJobSummary) => void;
  readonly organizationId: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const staged =
    activeJob !== null && activeJob.status === "awaiting_confirmation";

  const handleUpload = async () => {
    if (file === null) {
      return;
    }
    setIsUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("organizationId", organizationId);
      const response = await fetch(`${dataTransferApiBase()}/api/data/import`, {
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
            : ((await errorEnvelopeMessage(response)) ?? m.solid_calm_cub());
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
      onStaged(decoded.value);
      setFile(null);
    } catch {
      toastManager.add({ title: m.tidy_bold_yak(), type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{m.noble_sunny_crow()}</CardTitle>
        <CardDescription>{m.proud_witty_fox()}</CardDescription>
        {activeJob === null ? null : (
          <CardAction>
            <ImportStatusBadge status={activeJob.status} />
          </CardAction>
        )}
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
        <TemplateGuide />

        {activeJob === null ? (
          <>
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
            <span className="flex min-w-0 items-center gap-2">
              <HugeiconsIcon
                className="text-muted-foreground size-4.5 shrink-0"
                icon={FileSpreadsheetIcon}
              />
              <span className="truncate text-sm font-medium">
                {activeJob.fileName}
              </span>
            </span>
            {staged ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <ImportStat
                    label={m.bold_fresh_puma()}
                    value={plannedRowCount(activeJob)}
                  />
                  <ImportStat
                    label={m.gentle_smart_auk()}
                    tone="warning"
                    value={activeJob.warningCount}
                  />
                  <ImportStat
                    label={m.rustic_young_stork()}
                    tone="destructive"
                    value={activeJob.errorCount}
                  />
                </div>
                {activeJob.notices.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium">
                      {m.humble_sleek_carp()}
                    </span>
                    {activeJob.notices.map((notice) => (
                      <p className="text-muted-foreground text-xs" key={notice}>
                        {notice}
                      </p>
                    ))}
                  </div>
                ) : null}
              </>
            ) : (
              <ImportProgressBar job={activeJob} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                render={(buttonProps) => (
                  <Link
                    {...buttonProps}
                    params={{ jobId: activeJob.id, organizationId }}
                    to="/$organizationId/settings/data/imports/$jobId"
                  />
                )}
                size="sm"
              >
                {m.kind_brave_wren()}
              </Button>
              {isActiveStatus(activeJob.status) ? (
                <Button
                  disabled={busyJobId === activeJob.id}
                  onClick={() => onCancel(activeJob)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {m.crisp_honest_wren()}
                </Button>
              ) : null}
            </div>
            <p className="text-muted-foreground text-xs">
              {m.plain_bold_eagle()}
            </p>
          </div>
        )}
      </CardPanel>
      {activeJob === null ? (
        <CardFooter className="justify-end">
          <Button
            disabled={file === null}
            loading={isUploading}
            onClick={() => {
              void handleUpload();
            }}
            type="button"
          >
            {m.warm_wise_toad()}
          </Button>
        </CardFooter>
      ) : null}
    </Card>
  );
}

/** The workspace's posts as CSV, every board or one, through the download route. */
function ExportCard({ organizationId }: { readonly organizationId: string }) {
  const { boards } = useTransferBoards(organizationId);
  const [selectedBoard, setSelectedBoard] = useState(ALL_BOARDS);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const url = new URL(`${dataTransferApiBase()}/api/data/export`);
      url.searchParams.set("organizationId", organizationId);
      if (selectedBoard !== ALL_BOARDS) {
        url.searchParams.set("boardId", selectedBoard);
      }
      if (includeArchived) {
        url.searchParams.set("includeArchived", "true");
      }
      // A navigation would show the JSON error envelope (a 404, the row cap)
      // as the page; reading the response here keeps a failure a toast and a
      // success an in-page download.
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) {
        toastManager.add({
          title: (await errorEnvelopeMessage(response)) ?? m.sunny_kind_gecko(),
          type: "error",
        });
        return;
      }
      await downloadResponse(
        response,
        fallbackExportFileName(
          boards,
          selectedBoard === ALL_BOARDS ? null : selectedBoard
        )
      );
    } catch {
      toastManager.add({ title: m.sunny_kind_gecko(), type: "error" });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>{m.eager_plain_crab()}</CardTitle>
        <CardDescription>{m.gentle_happy_moth()}</CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-1 flex-col gap-4">
        <BoardPicker
          disabled={isExporting}
          onChange={setSelectedBoard}
          organizationId={organizationId}
          value={selectedBoard}
        />
        <SwitchCard variant="outline">
          <SwitchCardTitle>{m.lively_green_ibex()}</SwitchCardTitle>
          <SwitchCardInput
            checked={includeArchived}
            disabled={isExporting}
            onCheckedChange={setIncludeArchived}
          />
        </SwitchCard>
      </CardPanel>
      <CardFooter>
        <Button
          disabled={selectedBoard === ""}
          loading={isExporting}
          onClick={() => {
            void handleExport();
          }}
          type="button"
        >
          {m.merry_quiet_koi()}
        </Button>
      </CardFooter>
    </Card>
  );
}

/**
 * Every upload and what it is doing, newest first. The file name opens the
 * review page, which is the only place an import is confirmed; a row here
 * never writes posts by itself.
 */
function RecentImportsCard({
  busyJobId,
  onCancel,
  organizationId,
}: {
  readonly busyJobId: string | null;
  readonly onCancel: (job: TDataImportJobSummary) => void;
  readonly organizationId: string;
}) {
  const jobs = useTransferJobs(organizationId);

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
                <TableHead scope="col">{m.keen_calm_swan()}</TableHead>
                <TableHead scope="col">{m.soft_calm_mouse()}</TableHead>
                <TableHead scope="col">{m.sunny_swift_newt()}</TableHead>
                <TableHead scope="col">{m.proud_gentle_swan()}</TableHead>
                <TableHead className="text-right" scope="col">
                  <span className="sr-only">{m.brave_quick_auk()}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="max-w-[280px] truncate">
                    <Link
                      className="font-medium hover:underline"
                      params={{ jobId: job.id, organizationId }}
                      title={job.fileName}
                      to="/$organizationId/settings/data/imports/$jobId"
                    >
                      {job.fileName}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <ImportStatusBadge status={job.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <ImportResultText job={job} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {dayjs.default(job.createdAt).format("MMM D, YYYY")}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      {isActiveStatus(job.status) ? (
                        <Button
                          disabled={busyJobId === job.id}
                          onClick={() => onCancel(job)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          {m.crisp_honest_wren()}
                        </Button>
                      ) : null}
                      <Button
                        render={(buttonProps) => (
                          <Link
                            {...buttonProps}
                            params={{ jobId: job.id, organizationId }}
                            to="/$organizationId/settings/data/imports/$jobId"
                          />
                        )}
                        size="sm"
                        variant="ghost"
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

export function DataSettingsPage() {
  const organizationId = useOrganizationId();
  const { allowed: canImport, isPending: importPolicyPending } = usePolicy(
    hasPermission(organizationId, "boards.importPosts")
  );
  const { allowed: canExport, isPending: exportPolicyPending } = usePolicy(
    hasPermission(organizationId, "boards.exportData")
  );
  const cancelImport = useAtomSet(cancelDataImportAtom, { mode: "promise" });
  const jobs = useTransferJobs(organizationId);
  // The watch stream can lag one tick behind an upload; the local copy keeps
  // the card honest until the list catches up, and disappears once it does.
  const [localJob, setLocalJob] = useState<TDataImportJobSummary | null>(null);
  const [cancelTarget, setCancelTarget] =
    useState<TDataImportJobSummary | null>(null);
  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const listedActive = jobs.find((job) => isActiveStatus(job.status)) ?? null;
  const unlistedLocal =
    localJob !== null && !jobs.some((job) => job.id === localJob.id)
      ? localJob
      : null;
  const activeJob = listedActive ?? unlistedLocal;
  const awaitingJob =
    activeJob?.status === "awaiting_confirmation" ? activeJob : null;

  const showImport = canImport && !importPolicyPending;
  const showExport = canExport && !exportPolicyPending;

  const handleCancelConfirmed = async () => {
    if (cancelTarget === null) {
      return;
    }
    setBusyJobId(cancelTarget.id);
    try {
      await cancelImport({ payload: { id: cancelTarget.id, organizationId } });
      setLocalJob((current) =>
        current?.id === cancelTarget.id ? null : current
      );
      setCancelTarget(null);
    } catch {
      toastManager.add({ title: m.merry_plain_auk(), type: "error" });
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
        {awaitingJob === null ? null : (
          <Alert variant="info">
            <AlertTitle>{m.tidy_bold_moth()}</AlertTitle>
            <AlertDescription>{m.merry_calm_auk()}</AlertDescription>
            <AlertAction>
              <Button
                render={(buttonProps) => (
                  <Link
                    {...buttonProps}
                    params={{ jobId: awaitingJob.id, organizationId }}
                    to="/$organizationId/settings/data/imports/$jobId"
                  />
                )}
                size="sm"
              >
                {m.kind_brave_wren()}
              </Button>
            </AlertAction>
          </Alert>
        )}

        <div
          className={cn(
            "grid gap-6",
            showImport && showExport && "lg:grid-cols-2"
          )}
        >
          {showImport ? (
            <ImportCard
              activeJob={activeJob}
              busyJobId={busyJobId}
              onCancel={setCancelTarget}
              onStaged={setLocalJob}
              organizationId={organizationId}
            />
          ) : null}
          {showExport ? <ExportCard organizationId={organizationId} /> : null}
        </div>

        {showImport ? (
          <RecentImportsCard
            busyJobId={busyJobId}
            onCancel={setCancelTarget}
            organizationId={organizationId}
          />
        ) : null}
      </SettingsLayout.Content>

      {cancelTarget === null ? null : (
        <CancelImportDialog
          busy={busyJobId === cancelTarget.id}
          job={cancelTarget}
          onConfirm={() => {
            void handleCancelConfirmed();
          }}
          onOpenChange={(open) => {
            if (!open) {
              setCancelTarget(null);
            }
          }}
          open
        />
      )}
    </SettingsLayout.Root>
  );
}

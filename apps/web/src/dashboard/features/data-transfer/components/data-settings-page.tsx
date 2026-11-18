import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type { TDataImportJobSummary } from "@feeblo/domain/data-transfer/schema";
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
} from "@feeblo/ui/alert";
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
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { InboxDownloadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Result from "effect/reactivity/AsyncResult";
import { useState } from "react";

import { m } from "@/paraglide/messages.js";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";

import {
  dataTransferApiBase,
  downloadResponse,
  errorEnvelopeMessage,
} from "../api";
import {
  cancelDataImportAtom,
  dataImportJobsAtom,
  dataTransferBoardsAtom,
  type DataTransferBoard,
} from "../atoms";
import {
  canCancelStatus,
  canConfirmStatus,
  isActiveStatus,
  plannedRowCount,
} from "../format";
import { CancelImportDialog } from "./import-dialogs";
import { ImportSourcesSection } from "./import-source-cards";
import {
  ImportProgressBar,
  ImportResultText,
  ImportStat,
  ImportStatusBadge,
} from "./import-status";

/** The export picker's sentinel for "every board"; never a real board id. */
const ALL_BOARDS = "__all_boards__";

/** The boards the export picker names, read once for the card. */
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

  return Result.builder(jobsResult)
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
 * The one active import, whichever source produced it.
 *
 * The list is the authority, so this card survives a reload; a staged job
 * shows what confirming would create, and a running one shows how far the
 * worker has got. The review page is the only place a job is confirmed.
 */
function ActiveImportCard({
  busyJobId,
  job,
  onCancel,
  organizationId,
}: {
  readonly busyJobId: string | null;
  readonly job: TDataImportJobSummary;
  readonly onCancel: (job: TDataImportJobSummary) => void;
  readonly organizationId: string;
}) {
  const staged = canConfirmStatus(job.status);
  const cancelable = canCancelStatus(job.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {staged
            ? m.data_import_active_staged_title()
            : m.data_import_active_running_title()}
        </CardTitle>
        <CardDescription>{job.fileName}</CardDescription>
        <CardAction>
          <ImportStatusBadge status={job.status} />
        </CardAction>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        {staged ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <ImportStat
                label={m.bold_fresh_puma()}
                value={plannedRowCount(job)}
              />
              <ImportStat
                label={m.gentle_smart_auk()}
                tone="warning"
                value={job.warningCount}
              />
              <ImportStat
                label={m.rustic_young_stork()}
                tone="destructive"
                value={job.errorCount}
              />
            </div>
            {job.notices.length === 0 ? null : (
              <div className="flex flex-col gap-1">
                <span className="text-sm font-medium">
                  {m.humble_sleek_carp()}
                </span>
                {job.notices.slice(0, 3).map((notice) => (
                  <p className="text-muted-foreground text-xs" key={notice}>
                    {notice}
                  </p>
                ))}
              </div>
            )}
          </>
        ) : (
          <ImportProgressBar job={job} />
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            render={(buttonProps) => (
              <Link
                {...buttonProps}
                params={{ jobId: job.id, organizationId }}
                to="/$organizationId/settings/data/imports/$jobId"
              />
            )}
            size="sm"
          >
            {staged ? m.data_import_review_action() : m.kind_brave_wren()}
          </Button>
          {cancelable ? (
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
        </div>
        <p className="text-muted-foreground text-xs">
          {staged
            ? m.data_import_active_staged_hint()
            : m.data_import_active_running_hint()}
        </p>
      </CardPanel>
    </Card>
  );
}

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
              <EmptyTitle>{m.data_import_history_empty()}</EmptyTitle>
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

  // The watch stream can lag one tick behind an import that just staged; the
  // local copy keeps the card honest until the list catches up, and disappears
  // once it does. It carries its organization because a settings route can
  // change workspace without unmounting this page.
  const [localJob, setLocalJob] = useState<{
    readonly job: TDataImportJobSummary;
    readonly organizationId: string;
  } | null>(null);

  const [cancelTarget, setCancelTarget] =
    useState<TDataImportJobSummary | null>(null);

  const [busyJobId, setBusyJobId] = useState<string | null>(null);

  const listedActive = jobs.find((job) => isActiveStatus(job.status)) ?? null;

  const unlistedLocal =
    localJob?.organizationId === organizationId &&
    !jobs.some((job) => job.id === localJob.job.id)
      ? localJob.job
      : null;

  const activeJob = listedActive ?? unlistedLocal;

  const awaitingJob =
    activeJob !== null && canConfirmStatus(activeJob.status) ? activeJob : null;

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
        current?.job.id === cancelTarget.id ? null : current
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

        {showImport ? (
          <section className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <h2 className="text-lg font-semibold">
                {m.data_import_sources_title()}
              </h2>
              <p className="text-muted-foreground text-sm">
                {m.data_import_sources_description()}
              </p>
            </div>
            <ImportSourcesSection
              disabled={activeJob !== null}
              onStaged={(job) => setLocalJob({ job, organizationId })}
              organizationId={organizationId}
            />
            {activeJob === null ? null : (
              <ActiveImportCard
                busyJobId={busyJobId}
                job={activeJob}
                onCancel={setCancelTarget}
                organizationId={organizationId}
              />
            )}
          </section>
        ) : null}

        <div
          className={cn(
            "grid gap-6",
            showImport &&
              showExport &&
              "xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
          )}
        >
          {showImport ? (
            <RecentImportsCard
              busyJobId={busyJobId}
              onCancel={setCancelTarget}
              organizationId={organizationId}
            />
          ) : null}
          {showExport ? <ExportCard organizationId={organizationId} /> : null}
        </div>
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

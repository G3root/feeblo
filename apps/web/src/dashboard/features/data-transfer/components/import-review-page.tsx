import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  TDataImportJobSummary,
  TDataImportReportRow,
} from "@feeblo/domain/data-transfer/schema";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@feeblo/ui/card";
import {
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
} from "@feeblo/ui/collapsible";
import { Frame, FrameFooter } from "@feeblo/ui/frame";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@feeblo/ui/pagination";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { toastManager } from "@feeblo/ui/toast";
import * as dayjs from "@feeblo/utils/dayjs";
import {
  ArrowDown01Icon,
  ArrowLeft01Icon,
  ArrowUp01Icon,
  FileDownloadIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Result from "effect/reactivity/AsyncResult";
import { useEffect, useMemo, useRef, useState } from "react";

import { m } from "@/paraglide/messages.js";
import { SettingsLayout } from "~/features/settings/components/settings-layout";

import {
  dataTransferApiBase,
  downloadResponse,
  errorEnvelopeMessage,
} from "../api";
import {
  cancelDataImportAtom,
  confirmDataImportAtom,
  type DataImportDetailArgs,
  dataImportDetailAtom,
} from "../atoms";
import { isActiveStatus, plannedRowCount, statusLabel } from "../format";
import {
  DEFAULT_REVIEW_PAGE_SIZE,
  DEFAULT_REVIEW_SORT,
  type ReviewSearch,
} from "../search";
import { CancelImportDialog, ConfirmImportDialog } from "./import-dialogs";
import {
  ImportProgressBar,
  ImportStat,
  ImportStatusBadge,
} from "./import-status";

/** The page sizes the report offers; the server clamps to its own maximum. */
const PAGE_SIZE_OPTIONS = [25, 100, 250, 500] as const;

/** The board picker's sentinel for "every board"; never a real board name. */
const ALL_BOARDS = "__all_boards__";

const OUTCOME_LABELS = {
  created: m.plain_brave_crab,
  failed: m.rustic_young_stork,
  pending: m.fresh_plain_toad,
} satisfies Record<TDataImportReportRow["outcome"], () => string>;

const outcomeLabel = (row: TDataImportReportRow): string =>
  OUTCOME_LABELS[row.outcome]();

const OUTCOME_VARIANTS = {
  created: "default",
  failed: "destructive",
  pending: "secondary",
} satisfies Record<
  TDataImportReportRow["outcome"],
  "default" | "secondary" | "destructive"
>;

const outcomeVariant = (
  row: TDataImportReportRow
): "default" | "secondary" | "destructive" => OUTCOME_VARIANTS[row.outcome];

/**
 * What a row needs a person to know: its failure reason, or the substitutions
 * it will import with. A clean row reads as a dash, so the eye only stops on
 * the rows that need it.
 */
function RowDetails({ row }: { readonly row: TDataImportReportRow }) {
  if (row.message !== null) {
    return <span className="text-destructive">{row.message}</span>;
  }
  if (row.warnings.length === 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return (
    <span
      className="text-warning-foreground flex flex-col gap-0.5"
      title={row.warnings.join("\n")}
    >
      {row.warnings.map((warning) => (
        <span key={warning}>{warning}</span>
      ))}
    </span>
  );
}

/** The one back link, so every state of the page can return to the list. */
function BackToImportsButton({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  return (
    <Button
      render={(buttonProps) => (
        <Link
          {...buttonProps}
          params={{ organizationId }}
          to="/$organizationId/settings/data"
        />
      )}
      className="-ms-2"
      size="sm"
      variant="ghost"
    >
      <HugeiconsIcon icon={ArrowLeft01Icon} />
      {m.tidy_brisk_lynx()}
    </Button>
  );
}

/** One figure in the sticky confirm bar, label first and number last. */
function BarFigure({
  label,
  value,
}: {
  readonly label: string;
  readonly value: number;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </span>
  );
}

/** The report when the job is gone: retention removes both, so nothing is left to show. */
function UnavailableCard({
  organizationId,
}: {
  readonly organizationId: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.brave_soft_yak()}</CardTitle>
        <CardDescription>{m.merry_lucky_puma()}</CardDescription>
      </CardHeader>
      <div className="px-6 pb-6">
        <BackToImportsButton organizationId={organizationId} />
      </div>
    </Card>
  );
}

export function ImportReviewPage({
  jobId,
  onSearchChange,
  organizationId,
  search,
}: {
  readonly jobId: string;
  readonly onSearchChange: (patch: Partial<ReviewSearch>) => void;
  readonly organizationId: string;
  readonly search: ReviewSearch;
}) {
  const confirmImport = useAtomSet(confirmDataImportAtom, { mode: "promise" });
  const cancelImport = useAtomSet(cancelDataImportAtom, { mode: "promise" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [busy, setBusy] = useState<"confirm" | "cancel" | null>(null);
  const [downloading, setDownloading] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);

  const page = search.page ?? 0;
  const size = search.size ?? DEFAULT_REVIEW_PAGE_SIZE;
  const sort = search.sort ?? DEFAULT_REVIEW_SORT;

  const args = useMemo(
    (): DataImportDetailArgs => ({
      board: search.board ?? null,
      filter: search.filter ?? null,
      id: jobId,
      limit: size,
      message: search.message ?? null,
      offset: page * size,
      organizationId,
      sort,
    }),
    [
      jobId,
      organizationId,
      page,
      search.board,
      search.filter,
      search.message,
      size,
      sort,
    ]
  );
  const detailResult = useAtomValue(dataImportDetailAtom(args));
  const detail = Result.builder(detailResult)
    .onInitial(() => undefined)
    .onFailure((_, { previousSuccess }) =>
      Option.match(previousSuccess, {
        onNone: () => undefined,
        onSome: ({ value }) => value,
      })
    )
    .onSuccess((value) => value)
    .exhaustive();

  const status = detail?.job.status;
  const previousStatus = useRef<TDataImportJobSummary["status"] | null>(null);

  // Focus follows the navigation, so a keyboard user lands on the report
  // rather than at the top of the settings shell.
  useEffect(() => {
    titleRef.current?.focus();
  }, [jobId]);

  // A run that ends while the page is open says so, once. The same message
  // reaches screen readers through the live region below.
  useEffect(() => {
    if (status === undefined) {
      return;
    }
    const previous = previousStatus.current;
    previousStatus.current = status;
    if (
      previous === null ||
      !isActiveStatus(previous) ||
      isActiveStatus(status)
    ) {
      return;
    }
    toastManager.add({
      title:
        status === "completed"
          ? m.proud_fresh_wren()
          : status === "failed"
            ? m.brave_plain_crab()
            : m.plain_soft_auk(),
      type: status === "completed" ? "success" : "error",
    });
  }, [status]);

  if (Result.isFailure(detailResult) && detail === undefined) {
    return (
      <SettingsLayout.Root size="large">
        <SettingsLayout.Header>
          <SettingsLayout.HeaderTitle>
            {m.agile_bright_auk()}
          </SettingsLayout.HeaderTitle>
        </SettingsLayout.Header>
        <SettingsLayout.Content>
          <UnavailableCard organizationId={organizationId} />
        </SettingsLayout.Content>
      </SettingsLayout.Root>
    );
  }

  if (detail === undefined) {
    return null;
  }

  const job = detail.job;
  const counts = detail.report.counts;
  const failures = detail.report.failureGroups;
  const boards = detail.report.boardGroups;
  const rows = detail.report.rows;
  const total = detail.report.total;
  const pages = Math.max(1, Math.ceil(total / size));
  const from = total === 0 ? 0 : page * size + 1;
  const to = Math.min(total, (page + 1) * size);
  const problemCount = counts.failed + counts.warned;
  const awaiting = job.status === "awaiting_confirmation";
  const active = isActiveStatus(job.status);

  const filters = [
    { count: counts.total, filter: undefined, label: m.fresh_calm_auk() },
    {
      count: counts.pending,
      filter: "pending" as const,
      label: m.fresh_plain_toad(),
    },
    {
      count: counts.failed,
      filter: "failed" as const,
      label: m.rustic_young_stork(),
    },
    {
      count: counts.warned,
      filter: "warned" as const,
      label: m.gentle_smart_auk(),
    },
    {
      count: counts.created,
      filter: "created" as const,
      label: m.plain_brave_crab(),
    },
  ];
  const boardItems = [
    { label: m.leafy_calm_jay(), value: ALL_BOARDS },
    ...boards.map((board) => ({
      label: `${board.name} (${board.count})`,
      value: board.name,
    })),
  ];

  const handleConfirm = async () => {
    setBusy("confirm");
    try {
      await confirmImport({ payload: { id: job.id, organizationId } });
      setConfirmOpen(false);
    } catch {
      toastManager.add({ title: m.lucky_plain_gull(), type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleCancel = async () => {
    setBusy("cancel");
    try {
      await cancelImport({ payload: { id: job.id, organizationId } });
      setCancelOpen(false);
    } catch {
      toastManager.add({ title: m.merry_plain_auk(), type: "error" });
    } finally {
      setBusy(null);
    }
  };

  const handleDownloadProblems = async () => {
    setDownloading(true);
    try {
      const url = new URL(
        `${dataTransferApiBase()}/api/data/import/${encodeURIComponent(job.id)}/problems`
      );
      url.searchParams.set("organizationId", organizationId);
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
        `${job.fileName.replace(/\.csv$/iu, "")}-import-problems.csv`
      );
    } catch {
      toastManager.add({ title: m.sunny_kind_gecko(), type: "error" });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <SettingsLayout.Root size="large">
      <p aria-live="polite" className="sr-only">
        {statusLabel(job.status)}
      </p>
      <SettingsLayout.Header>
        <BackToImportsButton organizationId={organizationId} />
        <SettingsLayout.HeaderTitle
          className="w-full truncate outline-none"
          ref={titleRef}
          tabIndex={-1}
        >
          {job.fileName}
        </SettingsLayout.HeaderTitle>
        <SettingsLayout.HeaderDescription className="flex flex-wrap items-center gap-2">
          <ImportStatusBadge status={job.status} />
          <span>
            {m.proud_gentle_swan()} ·{" "}
            {dayjs.default(job.createdAt).format("MMM D, YYYY, HH:mm")}
          </span>
        </SettingsLayout.HeaderDescription>
      </SettingsLayout.Header>

      <SettingsLayout.Content>
        <div className="bg-background/95 sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-3 py-2 shadow-xs/5 backdrop-blur">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            {awaiting ? (
              <>
                <BarFigure
                  label={m.plain_bold_auk()}
                  value={plannedRowCount(job)}
                />
                {counts.warned > 0 ? (
                  <BarFigure label={m.kind_calm_moth()} value={counts.warned} />
                ) : null}
                {detail.newBoards.length > 0 ? (
                  <BarFigure
                    label={m.soft_brave_yak()}
                    value={detail.newBoards.length}
                  />
                ) : null}
              </>
            ) : (
              <span className="text-muted-foreground">
                {m.sunny_bold_wren({
                  created: job.createdCount,
                  total: job.rowCount,
                })}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {problemCount > 0 ? (
              <Button
                loading={downloading}
                onClick={() => {
                  void handleDownloadProblems();
                }}
                size="sm"
                variant="outline"
              >
                <HugeiconsIcon icon={FileDownloadIcon} />
                {m.lucky_plain_dove()}
              </Button>
            ) : null}
            {awaiting ? (
              <Button onClick={() => setConfirmOpen(true)} size="sm">
                {m.zesty_fresh_mole()}
              </Button>
            ) : null}
            {active ? (
              <Button
                onClick={() => setCancelOpen(true)}
                size="sm"
                variant="outline"
              >
                {m.crisp_honest_wren()}
              </Button>
            ) : null}
          </div>
        </div>

        {job.status === "running" || job.status === "queued" ? (
          <Card>
            <div className="p-5">
              <ImportProgressBar job={job} />
            </div>
          </Card>
        ) : null}

        {job.status === "failed" ? (
          <Alert variant="error">
            <AlertTitle>{m.rustic_young_stork()}</AlertTitle>
            <AlertDescription>
              <span>{job.failureMessage ?? m.sunny_mild_puma()}</span>
              <span>{m.fresh_quiet_auk()}</span>
            </AlertDescription>
          </Alert>
        ) : null}

        {job.status === "canceled" ? (
          <Alert variant="warning">
            <AlertTitle>{m.lucid_mellow_bass()}</AlertTitle>
            <AlertDescription>
              <span>{m.soft_calm_yak()}</span>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {filters.map((entry) => {
              const isActive = search.filter === entry.filter;
              if (entry.count === 0 && !isActive) {
                return null;
              }
              return (
                <Button
                  aria-current={isActive ? "page" : undefined}
                  key={entry.label}
                  render={(buttonProps) => (
                    <Link
                      {...buttonProps}
                      params={{ jobId, organizationId }}
                      search={{
                        ...search,
                        filter: entry.filter,
                        message: undefined,
                        page: 0,
                      }}
                      to="/$organizationId/settings/data/imports/$jobId"
                    />
                  )}
                  size="sm"
                  variant={isActive ? "outline" : "ghost"}
                >
                  {entry.label}
                  <Badge variant="secondary">{entry.count}</Badge>
                </Button>
              );
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              items={boardItems}
              onValueChange={(next) =>
                onSearchChange({
                  board: next === ALL_BOARDS ? undefined : (next ?? undefined),
                  page: 0,
                })
              }
              value={search.board ?? ALL_BOARDS}
            >
              <SelectTrigger aria-label={m.brave_lucky_newt()} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectPopup>
                {boardItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
            {search.filter === undefined &&
            search.board === undefined &&
            search.message === undefined ? null : (
              <Button
                onClick={() =>
                  onSearchChange({
                    board: undefined,
                    filter: undefined,
                    message: undefined,
                    page: 0,
                  })
                }
                size="sm"
                variant="ghost"
              >
                {m.tidy_plain_bass()}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <ImportStat label={m.bold_fresh_puma()} value={counts.pending} />
          <ImportStat label={m.plain_brave_crab()} value={counts.created} />
          <ImportStat
            label={m.rustic_young_stork()}
            tone="destructive"
            value={counts.failed}
          />
          <ImportStat
            label={m.gentle_smart_auk()}
            tone="warning"
            value={counts.warned}
          />
        </div>

        {search.message === undefined ? null : (
          <div className="bg-muted/20 flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-xs">
            <span className="text-muted-foreground">{m.plain_soft_ibex()}</span>
            <span className="font-medium">{search.message}</span>
            <Button
              onClick={() => onSearchChange({ message: undefined, page: 0 })}
              size="xs"
              variant="ghost"
            >
              {m.early_careful_coyote()}
            </Button>
          </div>
        )}

        {job.notices.length > 0 ? (
          <Collapsible defaultOpen={job.notices.length <= 3}>
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium data-panel-open:[&_svg]:rotate-180">
              <span>
                {m.humble_sleek_carp()} ({job.notices.length})
              </span>
              <HugeiconsIcon
                className="size-4 transition-transform"
                icon={ArrowDown01Icon}
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <ul className="flex flex-col gap-1 px-3 pt-3">
                {job.notices.map((notice) => (
                  <li className="text-muted-foreground text-xs" key={notice}>
                    {notice}
                  </li>
                ))}
              </ul>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}

        {detail.newBoards.length > 0 ? (
          <Collapsible defaultOpen>
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium data-panel-open:[&_svg]:rotate-180">
              <span>
                {m.plain_witty_auk()} ({detail.newBoards.length})
              </span>
              <HugeiconsIcon
                className="size-4 transition-transform"
                icon={ArrowDown01Icon}
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="flex flex-col gap-2 px-3 pt-3">
                <p className="text-muted-foreground text-xs">
                  {m.tidy_wise_yak()}
                </p>
                <ul className="flex flex-wrap gap-1">
                  {detail.newBoards.map((name) => (
                    <li key={name}>
                      <Badge variant="outline">{name}</Badge>
                    </li>
                  ))}
                </ul>
              </div>
            </CollapsiblePanel>
          </Collapsible>
        ) : null}

        {failures.length === 0 ? null : (
          <Collapsible defaultOpen={failures.length <= 5}>
            <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-sm font-medium data-panel-open:[&_svg]:rotate-180">
              <span className="flex items-center gap-2">
                {m.calm_swift_toad()}
                <Badge variant="secondary">{failures.length}</Badge>
              </span>
              <HugeiconsIcon
                className="size-4 transition-transform"
                icon={ArrowDown01Icon}
              />
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <ul className="flex flex-col gap-1 px-3 pt-3">
                {failures.map((group) => {
                  const isActive = search.message === group.message;
                  return (
                    <li key={group.message}>
                      <Button
                        aria-current={isActive ? "true" : undefined}
                        className="h-auto w-full justify-between gap-3 py-2 text-left whitespace-normal"
                        onClick={() =>
                          onSearchChange({
                            filter: "failed",
                            message: group.message,
                            page: 0,
                          })
                        }
                        size="sm"
                        variant={isActive ? "outline" : "ghost"}
                      >
                        <span>{group.message}</span>
                        <Badge variant="secondary">{group.count}</Badge>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </CollapsiblePanel>
          </Collapsible>
        )}

        <Frame>
          <Table variant="card">
            <TableHeader>
              <TableRow>
                <TableHead
                  aria-sort={sort === "row_asc" ? "ascending" : "descending"}
                  scope="col"
                >
                  <Button
                    className="-ms-2"
                    onClick={() =>
                      onSearchChange({
                        page: 0,
                        sort: sort === "row_asc" ? "row_desc" : "row_asc",
                      })
                    }
                    size="xs"
                    variant="ghost"
                  >
                    {m.calm_crisp_newt()}
                    <HugeiconsIcon
                      icon={
                        sort === "row_asc" ? ArrowUp01Icon : ArrowDown01Icon
                      }
                    />
                  </Button>
                </TableHead>
                <TableHead scope="col">{m.soft_bold_moth()}</TableHead>
                <TableHead scope="col">{m.keen_bold_kite()}</TableHead>
                <TableHead scope="col">{m.brave_lucky_newt()}</TableHead>
                <TableHead scope="col">{m.soft_calm_mouse()}</TableHead>
                <TableHead className="w-full" scope="col">
                  {m.plain_swift_wren()}
                </TableHead>
                <TableHead className="text-right" scope="col">
                  <span className="sr-only">{m.brave_quick_auk()}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell
                    className="text-muted-foreground h-24 text-center"
                    colSpan={7}
                  >
                    {m.quiet_bold_wren()}
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="tabular-nums">
                      {row.rowNumber}
                    </TableCell>
                    <TableCell>
                      <Badge variant={outcomeVariant(row)}>
                        {outcomeLabel(row)}
                      </Badge>
                    </TableCell>
                    <TableCell className="max-w-[260px]">
                      <p className="truncate">{row.title ?? "—"}</p>
                      {row.contentPreview === null ? null : (
                        <p className="text-muted-foreground truncate text-xs">
                          {row.contentPreview}
                        </p>
                      )}
                    </TableCell>
                    <TableCell>{row.boardName ?? "—"}</TableCell>
                    <TableCell>{row.statusName ?? "—"}</TableCell>
                    <TableCell className="max-w-md whitespace-pre-wrap">
                      <RowDetails row={row} />
                    </TableCell>
                    <TableCell className="text-right">
                      {row.boardSlug !== null && row.postSlug !== null ? (
                        <Button
                          render={(buttonProps) => (
                            <Link
                              {...buttonProps}
                              params={{
                                boardSlug: row.boardSlug ?? "",
                                organizationId,
                                postSlug: row.postSlug ?? "",
                              }}
                              to="/$organizationId/post/$boardSlug/$postSlug"
                            />
                          )}
                          size="xs"
                          variant="ghost"
                        >
                          {m.tidy_brave_auk()}
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <FrameFooter className="p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <p className="text-muted-foreground text-sm">
                  {m.warm_lucky_toad({ from, to, total })}
                </p>
                <p className="text-muted-foreground text-sm">
                  {m.plain_bold_moth()}
                </p>
                <Select
                  items={PAGE_SIZE_OPTIONS.map((option) => ({
                    label: String(option),
                    value: option,
                  }))}
                  onValueChange={(next) =>
                    onSearchChange({ page: 0, size: next ?? size })
                  }
                  value={size}
                >
                  <SelectTrigger
                    aria-label={m.plain_bold_moth()}
                    className="w-fit"
                    size="sm"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    {PAGE_SIZE_OPTIONS.map((size) => (
                      <SelectItem key={size} value={size}>
                        {size}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
              <Pagination className="w-fit justify-end">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      className="sm:*:[svg]:hidden"
                      render={
                        <Button
                          disabled={page === 0}
                          onClick={() => onSearchChange({ page: page - 1 })}
                          size="sm"
                          variant="outline"
                        />
                      }
                    />
                  </PaginationItem>
                  <PaginationItem>
                    <span className="text-muted-foreground px-2 text-sm tabular-nums">
                      {m.tidy_calm_auk({ page: page + 1, pages })}
                    </span>
                  </PaginationItem>
                  <PaginationItem>
                    <PaginationNext
                      className="sm:*:[svg]:hidden"
                      render={
                        <Button
                          disabled={page + 1 >= pages}
                          onClick={() => onSearchChange({ page: page + 1 })}
                          size="sm"
                          variant="outline"
                        />
                      }
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          </FrameFooter>
        </Frame>

        <p className="text-muted-foreground text-xs">
          {m.warm_plain_auk({
            date: dayjs.default(job.retentionExpiresAt).format("MMM D, YYYY"),
          })}
        </p>
      </SettingsLayout.Content>

      <ConfirmImportDialog
        busy={busy === "confirm"}
        job={job}
        newBoards={detail.newBoards}
        onConfirm={() => {
          void handleConfirm();
        }}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
      />
      <CancelImportDialog
        busy={busy === "cancel"}
        job={job}
        onConfirm={() => {
          void handleCancel();
        }}
        onOpenChange={setCancelOpen}
        open={cancelOpen}
      />
    </SettingsLayout.Root>
  );
}

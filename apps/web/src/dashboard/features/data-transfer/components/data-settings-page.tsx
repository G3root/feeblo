import { useAtomSet, useAtomValue } from "@effect/atom-react";
import type {
  TDataImportJobDetail,
  TDataImportJobSummary,
} from "@feeblo/domain/data-transfer/schema";
import { Badge } from "@feeblo/ui/badge";
import { Button } from "@feeblo/ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@feeblo/ui/card";
import { Input } from "@feeblo/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@feeblo/ui/table";
import { toastManager } from "@feeblo/ui/toast";
import { isPlainObject, isString } from "@feeblo/utils/runtime-kind";
import { getRuntimePublicEnv } from "@feeblo/web-shared/runtime-public-env";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/reactivity/AsyncResult";
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

/**
 * The board a transfer names. Reading the atom here rather than in the page
 * keeps the query unmounted for a member who sees neither transfer card.
 */
function BoardPicker({
  onChange,
  organizationId,
  value,
}: {
  readonly onChange: (boardId: string) => void;
  readonly organizationId: string;
  readonly value: string;
}) {
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
        onSome: ({ value: boards }) => boards,
      })
    )
    .onSuccess((value) => value)
    .exhaustive();

  return (
    <label className="flex flex-col gap-2 text-sm">
      <span className="font-medium">{m.brave_lucky_newt()}</span>
      <select
        className="border-input bg-background h-9 rounded-md border px-3 text-sm"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        <option value="" />
        {boards.map((board) => (
          <option key={board.id} value={board.id}>
            {board.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * The workspace's import jobs and the two actions a person takes on them.
 * The job list is a watch stream, so a confirm or a worker pass updates the
 * statuses without this card asking again.
 */
function ImportJobsCard({
  onSelectJob,
  organizationId,
}: {
  readonly onSelectJob: (jobId: string) => void;
  readonly organizationId: string;
}) {
  const jobsResult = useAtomValue(dataImportJobsAtom(organizationId));
  const confirmImport = useAtomSet(confirmDataImportAtom, { mode: "promise" });
  const cancelImport = useAtomSet(cancelDataImportAtom, { mode: "promise" });
  const [pendingAction, setPendingAction] = useState<{
    readonly id: string;
    readonly kind: "cancel" | "confirm";
  } | null>(null);

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

  const handleConfirm = async (job: TDataImportJobSummary) => {
    setPendingAction({ id: job.id, kind: "confirm" });
    onSelectJob(job.id);
    try {
      await confirmImport({ payload: { id: job.id, organizationId } });
    } catch {
      toastManager.add({ title: m.lucky_plain_gull(), type: "error" });
    } finally {
      setPendingAction(null);
    }
  };

  const handleCancel = async (job: TDataImportJobSummary) => {
    setPendingAction({ id: job.id, kind: "cancel" });
    try {
      await cancelImport({ payload: { id: job.id, organizationId } });
    } catch {
      toastManager.add({ title: m.merry_plain_auk(), type: "error" });
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.vivid_steady_hare()}</CardTitle>
      </CardHeader>
      <CardPanel>
        {jobs.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            {m.plain_gentle_robin()}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{m.keen_calm_swan()}</TableHead>
                <TableHead />
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell>
                    <button
                      className="text-left hover:underline"
                      onClick={() => onSelectJob(job.id)}
                      type="button"
                    >
                      {job.fileName}
                    </button>
                    <p className="text-muted-foreground text-xs">
                      {m.witty_loyal_bee({
                        created: job.createdCount,
                        errors: job.errorCount,
                        warnings: job.warningCount,
                      })}
                    </p>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant(job.status)}>
                      {statusLabel(job.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {job.status === "awaiting_confirmation" ? (
                      <Button
                        disabled={
                          pendingAction?.id === job.id &&
                          pendingAction.kind === "confirm"
                        }
                        onClick={() => {
                          void handleConfirm(job);
                        }}
                        size="sm"
                        type="button"
                      >
                        {m.zesty_fresh_mole({ count: job.rowCount })}
                      </Button>
                    ) : null}
                    {job.status === "awaiting_confirmation" ||
                    job.status === "queued" ||
                    job.status === "running" ? (
                      <Button
                        disabled={
                          pendingAction?.id === job.id &&
                          pendingAction.kind === "cancel"
                        }
                        onClick={() => {
                          void handleCancel(job);
                        }}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        {m.crisp_honest_wren()}
                      </Button>
                    ) : null}
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
  id,
  onClose,
  onPageChange,
  organizationId,
  page,
}: {
  readonly id: string;
  readonly onClose: () => void;
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

  const reportTotal = detail.report.total;
  const reportPages = Math.max(1, Math.ceil(reportTotal / REPORT_PAGE_SIZE));
  const reportFrom = reportTotal === 0 ? 0 : page * REPORT_PAGE_SIZE + 1;
  const reportTo = Math.min(reportTotal, (page + 1) * REPORT_PAGE_SIZE);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{m.agile_bright_auk()}</CardTitle>
        <CardDescription>
          {detail.job.failureMessage ??
            (detail.job.status === "failed"
              ? m.sunny_mild_puma()
              : statusLabel(detail.job.status))}
        </CardDescription>
      </CardHeader>
      <CardPanel className="flex flex-col gap-4">
        {detail.job.notices.length > 0 ? (
          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">{m.humble_sleek_carp()}</span>
            {detail.job.notices.map((notice) => (
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
      <CardFooter>
        <Button onClick={onClose} type="button" variant="outline">
          {m.deft_vivid_egret()}
        </Button>
      </CardFooter>
    </Card>
  );
}

export function DataSettingsPage() {
  const organizationId = useOrganizationId();
  const apiUrl = getRuntimePublicEnv().apiUrl;
  const { allowed: canImport, isPending: importPolicyPending } = usePolicy(
    hasPermission(organizationId, "boards.importPosts")
  );
  const { allowed: canExport, isPending: exportPolicyPending } = usePolicy(
    hasPermission(organizationId, "boards.exportData")
  );
  const [boardId, setBoardId] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [reportPage, setReportPage] = useState(0);
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);

  const selectJob = (jobId: string) => {
    setSelectedJobId(jobId);
    setReportPage(0);
  };

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
      const id = Predicate.hasProperty(payload, "id") ? payload.id : undefined;
      if (!(isPlainObject(payload) && isString(id))) {
        toastManager.add({ title: m.tidy_bold_yak(), type: "error" });
        return;
      }
      selectJob(id);
      setFile(null);
    } catch {
      toastManager.add({ title: m.tidy_bold_yak(), type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

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
        {canExport && !exportPolicyPending ? (
          <Card>
            <CardHeader>
              <CardTitle>{m.eager_plain_crab()}</CardTitle>
              <CardDescription>{m.gentle_happy_moth()}</CardDescription>
            </CardHeader>
            <CardPanel className="flex flex-col gap-4">
              <BoardPicker
                onChange={setBoardId}
                organizationId={organizationId}
                value={boardId}
              />
              <label className="flex items-center gap-2 text-sm">
                <input
                  checked={includeArchived}
                  onChange={(event) => setIncludeArchived(event.target.checked)}
                  type="checkbox"
                />
                {m.lively_green_ibex()}
              </label>
            </CardPanel>
            <CardFooter>
              <Button
                disabled={boardId === ""}
                onClick={handleExport}
                type="button"
              >
                {m.merry_quiet_koi()}
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {canImport && !importPolicyPending ? (
          <Card>
            <CardHeader>
              <CardTitle>{m.noble_sunny_crow()}</CardTitle>
              <CardDescription>{m.proud_witty_fox()}</CardDescription>
            </CardHeader>
            <CardPanel className="flex flex-col gap-4">
              <BoardPicker
                onChange={setBoardId}
                organizationId={organizationId}
                value={boardId}
              />
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">{m.keen_calm_swan()}</span>
                <Input
                  accept=".csv,text/csv"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
              <p className="text-muted-foreground text-xs">
                {m.sturdy_bold_crab()}
              </p>
            </CardPanel>
            <CardFooter>
              <Button
                disabled={file === null || boardId === "" || isUploading}
                onClick={() => {
                  void handleUpload();
                }}
                type="button"
              >
                {m.warm_wise_toad()}
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {canImport && !importPolicyPending ? (
          <ImportJobsCard
            onSelectJob={selectJob}
            organizationId={organizationId}
          />
        ) : null}

        {selectedJobId !== null ? (
          <ImportDetailCard
            id={selectedJobId}
            onClose={() => {
              setSelectedJobId(null);
              setReportPage(0);
            }}
            onPageChange={setReportPage}
            organizationId={organizationId}
            page={reportPage}
          />
        ) : null}
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

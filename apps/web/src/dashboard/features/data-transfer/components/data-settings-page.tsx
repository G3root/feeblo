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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Predicate from "effect/Predicate";
import { useState } from "react";

import { m } from "@/paraglide/messages.js";
import { SettingsLayout } from "~/features/settings/components/settings-layout";
import { useOrganizationId } from "~/hooks/use-organization-id";
import { fetchRpc } from "~/lib/runtime";

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

export function DataSettingsPage() {
  const organizationId = useOrganizationId();
  const queryClient = useQueryClient();
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

  const boardsQuery = useQuery({
    queryKey: ["data-transfer-boards", organizationId],
    queryFn: () => fetchRpc((rpc) => rpc.BoardList({ organizationId })),
    enabled: canExport || canImport,
  });

  const importsQuery = useQuery({
    queryKey: ["data-transfer-imports", organizationId],
    queryFn: () => fetchRpc((rpc) => rpc.DataImportList({ organizationId })),
    enabled: canImport,
    refetchInterval: 3000,
  });

  const detailQuery = useQuery({
    queryKey: [
      "data-transfer-import",
      organizationId,
      selectedJobId,
      reportPage,
    ],
    queryFn: () => {
      const id = selectedJobId;
      if (id === null) {
        return Promise.reject(new Error("No import selected"));
      }
      return fetchRpc((rpc) =>
        rpc.DataImportGet({
          id,
          organizationId,
          limit: REPORT_PAGE_SIZE,
          offset: reportPage * REPORT_PAGE_SIZE,
        })
      );
    },
    enabled: canImport && selectedJobId !== null,
    refetchInterval: 3000,
  });

  const refreshJobs = () =>
    queryClient.invalidateQueries({
      queryKey: ["data-transfer-imports", organizationId],
    });

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
      setSelectedJobId(id);
      setReportPage(0);
      setFile(null);
      await refreshJobs();
    } catch {
      toastManager.add({ title: m.tidy_bold_yak(), type: "error" });
    } finally {
      setIsUploading(false);
    }
  };

  const confirmJob = useMutation({
    mutationFn: (id: string) =>
      fetchRpc((rpc) => rpc.DataImportConfirm({ id, organizationId })),
    onError: () => {
      toastManager.add({ title: m.lucky_plain_gull(), type: "error" });
    },
    onSuccess: refreshJobs,
  });

  const cancelJob = useMutation({
    mutationFn: (id: string) =>
      fetchRpc((rpc) => rpc.DataImportCancel({ id, organizationId })),
    onError: () => {
      toastManager.add({ title: m.merry_plain_auk(), type: "error" });
    },
    onSuccess: refreshJobs,
  });

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

  const boards = boardsQuery.data ?? [];
  const jobs = importsQuery.data ?? [];
  const detail: TDataImportJobDetail | undefined = detailQuery.data;
  const reportTotal = detail?.report.total ?? 0;
  const reportPages = Math.max(1, Math.ceil(reportTotal / REPORT_PAGE_SIZE));
  const reportFrom = reportTotal === 0 ? 0 : reportPage * REPORT_PAGE_SIZE + 1;
  const reportTo = Math.min(reportTotal, (reportPage + 1) * REPORT_PAGE_SIZE);

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
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">{m.brave_lucky_newt()}</span>
                <select
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  onChange={(event) => setBoardId(event.target.value)}
                  value={boardId}
                >
                  <option value="" />
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
              </label>
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
              <label className="flex flex-col gap-2 text-sm">
                <span className="font-medium">{m.brave_lucky_newt()}</span>
                <select
                  className="border-input bg-background h-9 rounded-md border px-3 text-sm"
                  onChange={(event) => setBoardId(event.target.value)}
                  value={boardId}
                >
                  <option value="" />
                  {boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </select>
              </label>
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
                onClick={handleUpload}
                type="button"
              >
                {m.warm_wise_toad()}
              </Button>
            </CardFooter>
          </Card>
        ) : null}

        {canImport && !importPolicyPending ? (
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
                            onClick={() => {
                              setSelectedJobId(job.id);
                              setReportPage(0);
                            }}
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
                              disabled={confirmJob.isPending}
                              onClick={() => {
                                confirmJob.mutate(job.id);
                                setSelectedJobId(job.id);
                                setReportPage(0);
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
                              disabled={cancelJob.isPending}
                              onClick={() => cancelJob.mutate(job.id)}
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
        ) : null}

        {detail !== undefined ? (
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
                  <span className="text-sm font-medium">
                    {m.humble_sleek_carp()}
                  </span>
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
                      disabled={reportPage === 0}
                      onClick={() => setReportPage((page) => page - 1)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      {m.calm_brisk_auk()}
                    </Button>
                    <Button
                      disabled={reportPage + 1 >= reportPages}
                      onClick={() => setReportPage((page) => page + 1)}
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
              <Button
                onClick={() => {
                  setSelectedJobId(null);
                  setReportPage(0);
                }}
                type="button"
                variant="outline"
              >
                {m.deft_vivid_egret()}
              </Button>
            </CardFooter>
          </Card>
        ) : null}
      </SettingsLayout.Content>
    </SettingsLayout.Root>
  );
}

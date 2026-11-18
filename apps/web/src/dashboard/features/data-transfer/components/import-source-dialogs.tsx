import { useAtomSet } from "@effect/atom-react";
import {
  BOARD_POST_CSV_COLUMNS,
  BOARD_POST_CSV_TEMPLATE,
} from "@feeblo/domain-contracts/board-csv";
import { DATA_IMPORT_MAX_BYTES } from "@feeblo/domain/data-transfer/limits";
import type { TDataImportProviderDescriptor } from "@feeblo/domain/data-transfer/provider-schema";
import {
  DataImportJobSummary,
  type TDataImportJobSummary,
} from "@feeblo/domain/data-transfer/schema";
import { Alert, AlertDescription, AlertTitle } from "@feeblo/ui/alert";
import { Button } from "@feeblo/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@feeblo/ui/dialog";
import { useAppForm } from "@feeblo/ui/hooks/form";
import { toastManager } from "@feeblo/ui/toast";
import { cn } from "@feeblo/ui/utils";
import {
  CheckmarkCircle02Icon,
  FileSpreadsheetIcon,
  FileUploadIcon,
  LinkSquare02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useState } from "react";
import { z } from "zod";

import { m } from "@/paraglide/messages.js";

import {
  dataTransferApiBase,
  downloadBlob,
  errorEnvelopeMessage,
} from "../api";
import { startProviderDataImportAtom } from "../atoms";
import { plannedRowCount } from "../format";
import { useImportStart } from "../use-import-start";
import { ImportStat } from "./import-status";

const csvFileNamePattern = /\.csv$/iu;

/** The same template the parser reads, so a column cannot drift out of it. */
const downloadImportTemplate = () => {
  downloadBlob(
    new Blob([BOARD_POST_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }),
    "board-import-template.csv"
  );
};

/** The staged job, shown once the server has parsed and planned it. */
function StagedImport({
  job,
  onDone,
  organizationId,
}: {
  readonly job: TDataImportJobSummary;
  readonly onDone: () => void;
  readonly organizationId: string;
}) {
  return (
    <>
      <DialogPanel className="flex flex-col gap-4">
        <Alert variant="success">
          <HugeiconsIcon icon={CheckmarkCircle02Icon} />
          <AlertTitle>{m.data_import_staged_title()}</AlertTitle>
          <AlertDescription>
            {m.data_import_staged_description()}
          </AlertDescription>
        </Alert>
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
          <ul className="flex flex-col gap-1">
            {job.notices.slice(0, 4).map((notice) => (
              <li className="text-muted-foreground text-xs" key={notice}>
                {notice}
              </li>
            ))}
          </ul>
        )}
      </DialogPanel>
      <DialogFooter>
        <DialogClose render={<Button type="button" variant="ghost" />}>
          {m.data_import_close()}
        </DialogClose>
        <Button
          onClick={onDone}
          render={(buttonProps) => (
            <Link
              {...buttonProps}
              params={{ jobId: job.id, organizationId }}
              to="/$organizationId/settings/data/imports/$jobId"
            />
          )}
        >
          {m.data_import_review_action()}
        </Button>
      </DialogFooter>
    </>
  );
}

/**
 * What a person is told before they choose a file or paste a key: an import
 * creates posts and does not fire the notifications a normal post would. It is
 * here, not on the review page, because it changes whether they start at all.
 */
function ImportDisclosure({
  children,
}: {
  readonly children: React.ReactNode;
}) {
  return (
    <p className="text-muted-foreground bg-muted/30 rounded-lg border px-3 py-2 text-xs">
      {children}
    </p>
  );
}

export function CsvImportDialog({
  onOpenChange,
  onStaged,
  onStartingChange,
  open,
  organizationId,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onStaged: (job: TDataImportJobSummary) => void;
  readonly onStartingChange: (starting: boolean) => void;
  readonly open: boolean;
  readonly organizationId: string;
}) {
  const start = useImportStart(m.data_import_csv_failed());
  const [file, setFile] = useState<File | null>(null);

  const [stagedJob, setStagedJob] = useState<TDataImportJobSummary | null>(
    null
  );

  const [isDragging, setIsDragging] = useState(false);

  const accept = (candidate: File | null) => {
    if (candidate === null) {
      setFile(null);

      return;
    }

    if (!csvFileNamePattern.test(candidate.name)) {
      toastManager.add({
        title: m.data_import_csv_choose_csv(),
        type: "error",
      });

      return;
    }

    if (candidate.size > DATA_IMPORT_MAX_BYTES) {
      toastManager.add({ title: m.data_import_csv_too_large(), type: "error" });

      return;
    }

    setFile(candidate);
  };

  const upload = async () => {
    if (file === null) {
      return;
    }

    onStartingChange(true);

    try {
      await start.run(async () => {
        const body = new FormData();
        body.append("file", file);
        body.append("organizationId", organizationId);

        const response = await fetch(
          `${dataTransferApiBase()}/api/data/import`,
          {
            body,
            credentials: "include",
            method: "POST",
          }
        );

        if (!response.ok) {
          const message = await errorEnvelopeMessage(response);

          throw new Error(message ?? m.data_import_csv_failed());
        }

        const payload: unknown = await response.json();

        // SAFETY: the endpoint contract returns a DataImportJobSummary; the
        // schema rejects drift instead of letting it reach the review panel.
        // This is a React event handler, not Effect code, so the Option is
        // the recovery path.
        // eslint-disable-next-line effecttsgo/schema-sync -- non-Effect React boundary
        const decoded =
          Schema.decodeUnknownOption(DataImportJobSummary)(payload);

        if (Option.isNone(decoded)) {
          throw new Error(m.data_import_csv_failed());
        }

        setStagedJob(decoded.value);
        onStaged(decoded.value);
      });
    } finally {
      onStartingChange(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>{m.data_import_csv_dialog_title()}</DialogTitle>
          <DialogDescription>
            {m.data_import_csv_dialog_description()}
          </DialogDescription>
        </DialogHeader>

        {stagedJob === null ? (
          <>
            <DialogPanel className="flex flex-col gap-4">
              <ImportDisclosure>
                {m.data_import_backfill_disclosure()}
              </ImportDisclosure>
              <label
                className={cn(
                  "border-border/70 bg-muted/20 focus-within:ring-ring/24 hover:bg-muted/40 relative flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-8 text-center transition-colors focus-within:ring-[3px]",
                  isDragging && "border-primary/60 bg-muted/60",
                  start.phase === "starting" && "pointer-events-none opacity-64"
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
                    <span className="text-sm font-medium">
                      {m.data_import_csv_dropzone()}
                    </span>
                    <span className="text-muted-foreground max-w-sm text-xs">
                      {m.data_import_csv_dropzone_hint()}
                    </span>
                  </>
                ) : (
                  <span className="flex max-w-full items-center gap-2">
                    <span className="truncate text-sm font-medium">
                      {file.name}
                    </span>
                    <Button
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        accept(null);
                      }}
                      size="xs"
                      type="button"
                      variant="ghost"
                    >
                      {m.data_import_remove_file()}
                    </Button>
                  </span>
                )}
                <input
                  accept=".csv,text/csv"
                  aria-label={m.data_import_csv_dropzone()}
                  className="sr-only"
                  disabled={start.phase === "starting"}
                  onChange={(event) => accept(event.target.files?.[0] ?? null)}
                  type="file"
                />
              </label>
              <div className="border-border/70 bg-muted/20 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2">
                <p className="text-muted-foreground text-xs">
                  {m.data_import_csv_template_hint()}
                </p>
                <Button
                  onClick={downloadImportTemplate}
                  size="xs"
                  type="button"
                  variant="ghost"
                >
                  {m.data_import_csv_template_action()}
                </Button>
              </div>
              <details className="group">
                <summary className="text-muted-foreground cursor-pointer text-xs">
                  {m.data_import_csv_columns_count({
                    count: BOARD_POST_CSV_COLUMNS.length,
                  })}
                </summary>
                <div className="mt-2 flex flex-wrap gap-1">
                  {BOARD_POST_CSV_COLUMNS.map((column) => (
                    <span
                      className="bg-muted rounded px-1.5 py-0.5 text-[11px]"
                      key={column}
                    >
                      {column}
                    </span>
                  ))}
                </div>
              </details>
              {start.error === null ? null : (
                <Alert variant="error">
                  <AlertTitle>{m.data_import_csv_failed()}</AlertTitle>
                  <AlertDescription>{start.error}</AlertDescription>
                </Alert>
              )}
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {m.data_import_cancel_action()}
              </DialogClose>
              {start.phase === "failed" ? (
                <Button onClick={start.retry} type="button" variant="outline">
                  {m.data_import_retry_action()}
                </Button>
              ) : null}
              <Button
                disabled={file === null}
                loading={start.phase === "starting"}
                onClick={() => {
                  void upload();
                }}
                type="button"
              >
                {m.data_import_csv_stage_action()}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <StagedImport
            job={stagedJob}
            onDone={() => onOpenChange(false)}
            organizationId={organizationId}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

export function ProviderImportDialog({
  onOpenChange,
  onStaged,
  onStartingChange,
  open,
  organizationId,
  provider,
}: {
  readonly onOpenChange: (open: boolean) => void;
  readonly onStaged: (job: TDataImportJobSummary) => void;
  readonly onStartingChange: (starting: boolean) => void;
  readonly open: boolean;
  readonly organizationId: string;
  readonly provider: TDataImportProviderDescriptor;
}) {
  const startImport = useAtomSet(startProviderDataImportAtom, {
    mode: "promise",
  });

  const start = useImportStart(m.data_import_provider_failed());

  const [stagedJob, setStagedJob] = useState<TDataImportJobSummary | null>(
    null
  );

  // SAFETY: every credential field's default is the empty string, so the
  // object literal is a string record whatever keys the descriptor declares.
  const credentials = Object.fromEntries(
    provider.credentialFields.map((field) => [field.key, ""])
  ) as Record<string, string>;

  const form = useAppForm({
    defaultValues: credentials,
    validators: {
      onSubmit: z.object(
        Object.fromEntries(
          provider.credentialFields.map((field) => [
            field.key,
            z
              .string()
              .trim()
              .min(
                1,
                m.data_import_provider_field_required({ field: field.label })
              ),
          ])
        )
      ),
    },
    onSubmit: async ({ value }) => {
      onStartingChange(true);

      try {
        await start.run(async () => {
          const job = await startImport({
            payload: {
              credentials: value,
              organizationId,
              provider: provider.id,
            },
          });

          setStagedJob(job);
          onStaged(job);
        });
      } finally {
        onStartingChange(false);
      }
    },
  });

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>
            {m.data_import_provider_dialog_title({ provider: provider.name })}
          </DialogTitle>
          <DialogDescription>{provider.tagline}</DialogDescription>
        </DialogHeader>

        {stagedJob === null ? (
          <form
            className="contents"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void form.handleSubmit();
            }}
          >
            <DialogPanel className="flex flex-col gap-4">
              <ImportDisclosure>
                {m.data_import_backfill_disclosure()}
              </ImportDisclosure>
              <ul className="flex flex-col gap-1.5 text-xs">
                {provider.carries.map((item) => (
                  <li className="flex items-center gap-2" key={item}>
                    <HugeiconsIcon
                      className="text-primary size-3.5 shrink-0"
                      icon={CheckmarkCircle02Icon}
                    />
                    <span>{item}</span>
                  </li>
                ))}
                {provider.omissions.map((item) => (
                  <li
                    className="text-muted-foreground flex items-center gap-2"
                    key={item}
                  >
                    <span
                      aria-hidden
                      className="bg-muted-foreground/40 size-1 shrink-0 rounded-full"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              {provider.credentialFields.map((field) => (
                <div className="flex flex-col gap-1" key={field.key}>
                  <form.AppField name={field.key}>
                    {(formField) => (
                      <formField.TextField
                        autoComplete="off"
                        label={field.label}
                        placeholder={field.placeholder}
                        type={field.secret ? "password" : "text"}
                      />
                    )}
                  </form.AppField>
                  <p className="text-muted-foreground text-xs">
                    {field.description}
                  </p>
                </div>
              ))}
              <a
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline underline-offset-4"
                href={provider.helpUrl}
                rel="noreferrer"
                target="_blank"
              >
                {provider.helpText}
                <HugeiconsIcon className="size-3.5" icon={LinkSquare02Icon} />
              </a>
              {start.error === null ? null : (
                <Alert variant="error">
                  <AlertTitle>{m.data_import_provider_failed()}</AlertTitle>
                  <AlertDescription>{start.error}</AlertDescription>
                </Alert>
              )}
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button type="button" variant="ghost" />}>
                {m.data_import_cancel_action()}
              </DialogClose>
              {start.phase === "failed" ? (
                <Button onClick={start.retry} type="button" variant="outline">
                  {m.data_import_retry_action()}
                </Button>
              ) : null}
              <form.Subscribe
                selector={(state) =>
                  Object.values(state.values).every(
                    (value) => value.trim().length > 0
                  )
                }
              >
                {(filled) => (
                  <form.AppForm>
                    <form.SubscribeButton
                      disabled={!filled}
                      label={m.data_import_provider_stage_action({
                        provider: provider.name,
                      })}
                    />
                  </form.AppForm>
                )}
              </form.Subscribe>
            </DialogFooter>
          </form>
        ) : (
          <StagedImport
            job={stagedJob}
            onDone={() => onOpenChange(false)}
            organizationId={organizationId}
          />
        )}
      </DialogPopup>
    </Dialog>
  );
}

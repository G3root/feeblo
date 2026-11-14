import { transaction } from "@feeblo/db";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { actorFromSession } from "../audit-log/attribution";
import { AuditLogRecorder } from "../audit-log/recorder";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { DataImportService } from "./import-service";
import { toDataImportJobDetail, toDataImportJobSummary } from "./mappers";
import { DataTransferRpcs } from "./rpcs";
import type {
  TDataImportCancel,
  TDataImportConfirm,
  TDataImportGet,
  TDataImportList,
} from "./schema";

/**
 * The report window and its narrowing cross the RPC as optional keys; this
 * drops the absent ones so the service sees one shape whether the caller sent
 * a filter or not.
 */
const toDescribeInput = (args: TDataImportGet) => ({
  board: args.board,
  filter: args.filter,
  id: args.id,
  limit: args.limit,
  message: args.message,
  offset: args.offset,
  organizationId: args.organizationId,
  sort: args.sort,
});

export const DataTransferRpcHandlersEffect = Effect.gen(function* () {
  const service = yield* DataImportService;

  return {
    // Canceling stops a job but moves no customer data and removes nothing,
    // and the catalog declares no verb for it: the two entries this feature
    // writes for a transfer are the import it released and the export it
    // produced. Deliberately not recorded.
    CancelDataImport: (args: TDataImportCancel) =>
      service.cancelImport({
        id: args.id,
        organizationId: args.organizationId,
      }),
    ConfirmDataImport: (args: TDataImportConfirm) =>
      Effect.gen(function* () {
        const session = yield* CurrentSession;
        const audit = yield* AuditLogRecorder;
        yield* transaction(
          Effect.gen(function* () {
            yield* service.confirmImport({
              id: args.id,
              organizationId: args.organizationId,
            });
            // In the confirm's transaction, so the job moving to `queued` and
            // the entry commit together. `data_transfer` is a singleton
            // resource (the catalog marks it so), which is why the job id goes
            // in `metadata` rather than a resource id; the job row expires and
            // the entry is what remains to say which import was released.
            yield* audit.record({
              organizationId: args.organizationId,
              actor: actorFromSession(session, args.organizationId),
              source: "dashboard",
              action: "data_transfer.imported",
              metadata: { jobId: args.id },
            });
          })
        );
      }).pipe(withRemapDbErrors("DataTransfer", "update")),
    GetDataImport: (args: TDataImportGet) =>
      service
        .describeImport(toDescribeInput(args))
        .pipe(Effect.map(toDataImportJobDetail)),
    ListDataImports: (args: TDataImportList) =>
      service
        .listImports({ organizationId: args.organizationId })
        .pipe(Effect.map((jobs) => jobs.map(toDataImportJobSummary))),
    WatchDataImports: (args: TDataImportList) =>
      service
        .watchImportList({ organizationId: args.organizationId })
        .pipe(Stream.map((jobs) => jobs.map(toDataImportJobSummary))),
    WatchDataImport: (args: TDataImportGet) =>
      service
        .watchImport(toDescribeInput(args))
        .pipe(Stream.map(toDataImportJobDetail)),
  };
});

export const DataTransferRpcHandlers = DataTransferRpcs.toLayer(
  DataTransferRpcHandlersEffect
).pipe(
  Layer.provide(DataImportService.layer),
  Layer.provide(AuditLogRecorder.layer)
);

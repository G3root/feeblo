import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { DataImportService } from "./import-service";
import { toDataImportJobDetail, toDataImportJobSummary } from "./mappers";
import { DataTransferRpcs } from "./rpcs";
import type {
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
    DataImportCancel: (args: TDataImportConfirm) =>
      service.cancelImport({
        id: args.id,
        organizationId: args.organizationId,
      }),
    DataImportConfirm: (args: TDataImportConfirm) =>
      service.confirmImport({
        id: args.id,
        organizationId: args.organizationId,
      }),
    DataImportGet: (args: TDataImportGet) =>
      service
        .describeImport(toDescribeInput(args))
        .pipe(Effect.map(toDataImportJobDetail)),
    DataImportList: (args: TDataImportList) =>
      service
        .listImports({ organizationId: args.organizationId })
        .pipe(Effect.map((jobs) => jobs.map(toDataImportJobSummary))),
    DataImportListWatch: (args: TDataImportList) =>
      service.watchImportList({ organizationId: args.organizationId }),
    DataImportWatch: (args: TDataImportGet) =>
      service
        .watchImport(toDescribeInput(args))
        .pipe(Stream.map(toDataImportJobDetail)),
  };
});

export const DataTransferRpcHandlers = DataTransferRpcs.toLayer(
  DataTransferRpcHandlersEffect
).pipe(Layer.provide(DataImportService.layer));

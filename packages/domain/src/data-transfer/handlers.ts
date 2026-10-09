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
        .describeImport({
          id: args.id,
          organizationId: args.organizationId,
          ...(args.limit !== undefined && { limit: args.limit }),
          ...(args.offset !== undefined && { offset: args.offset }),
        })
        .pipe(Effect.map(toDataImportJobDetail)),
    DataImportList: (args: TDataImportList) =>
      service
        .listImports({ organizationId: args.organizationId })
        .pipe(Effect.map((jobs) => jobs.map(toDataImportJobSummary))),
    DataImportListWatch: (args: TDataImportList) =>
      service.watchImportList({ organizationId: args.organizationId }),
    DataImportWatch: (args: TDataImportGet) =>
      service
        .watchImport({
          id: args.id,
          organizationId: args.organizationId,
          ...(args.limit !== undefined && { limit: args.limit }),
          ...(args.offset !== undefined && { offset: args.offset }),
        })
        .pipe(Stream.map(toDataImportJobDetail)),
  };
});

export const DataTransferRpcHandlers = DataTransferRpcs.toLayer(
  DataTransferRpcHandlersEffect
).pipe(Layer.provide(DataImportService.layer));

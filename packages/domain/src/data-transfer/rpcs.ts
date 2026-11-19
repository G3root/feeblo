import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { DataTransferServiceErrors } from "./errors";
import { DataImportProviderDescriptor } from "./provider-schema";
import {
  DataImportCancel,
  DataImportConfirm,
  DataImportGet,
  DataImportJobDetail,
  DataImportJobSummary,
  DataImportList,
  DataImportProviderList,
  DataImportProviderStart,
} from "./schema";

/**
 * The dashboard's import control plane. The upload and the download are file
 * transfers and live on the dashboard HTTP API; what is left here is the job
 * list, the report, the two state transitions a person makes, and the two
 * watchers that keep the page live while the worker drains a confirmed job.
 */
export class DataTransferRpcs extends RpcGroup.make(
  Rpc.make("ListDataImports", {
    error: DataTransferServiceErrors,
    payload: DataImportList,
    success: Schema.Array(DataImportJobSummary),
  }).middleware(AuthMiddleware),
  // The provider import's two controls: what this deployment offers, and the
  // one call that fetches a provider's posts and stages them. Both stay RPCs
  // on purpose — a provider API key must not travel through the dashboard's
  // file-transfer routes, which are for bytes a browser already holds.
  Rpc.make("ListDataImportProviders", {
    error: DataTransferServiceErrors,
    payload: DataImportProviderList,
    success: Schema.Array(DataImportProviderDescriptor),
  }).middleware(AuthMiddleware),
  Rpc.make("StartProviderDataImport", {
    error: DataTransferServiceErrors,
    payload: DataImportProviderStart,
    success: DataImportJobSummary,
  }).middleware(AuthMiddleware),
  Rpc.make("GetDataImport", {
    error: DataTransferServiceErrors,
    payload: DataImportGet,
    success: DataImportJobDetail,
  }).middleware(AuthMiddleware),
  Rpc.make("ConfirmDataImport", {
    error: DataTransferServiceErrors,
    payload: DataImportConfirm,
    success: Schema.Void,
  }).middleware(AuthMiddleware),
  Rpc.make("CancelDataImport", {
    error: DataTransferServiceErrors,
    payload: DataImportCancel,
    success: Schema.Void,
  }).middleware(AuthMiddleware),
  Rpc.make("WatchDataImports", {
    error: DataTransferServiceErrors,
    payload: DataImportList,
    stream: true,
    success: Schema.Array(DataImportJobSummary),
  }).middleware(AuthMiddleware),
  Rpc.make("WatchDataImport", {
    error: DataTransferServiceErrors,
    payload: DataImportGet,
    stream: true,
    success: DataImportJobDetail,
  }).middleware(AuthMiddleware)
) {}

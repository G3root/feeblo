import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { DataTransferServiceErrors } from "./errors";
import {
  DataImportCancel,
  DataImportConfirm,
  DataImportGet,
  DataImportJobDetail,
  DataImportJobSummary,
  DataImportList,
} from "./schema";

/**
 * The dashboard's import control plane. The upload and the download are file
 * transfers and live on the dashboard HTTP API; what is left here is the job
 * list, the report, and the two state transitions a person makes.
 */
export class DataTransferRpcs extends RpcGroup.make(
  Rpc.make("DataImportList", {
    error: DataTransferServiceErrors,
    payload: DataImportList,
    success: Schema.Array(DataImportJobSummary),
  }).middleware(AuthMiddleware),
  Rpc.make("DataImportGet", {
    error: DataTransferServiceErrors,
    payload: DataImportGet,
    success: DataImportJobDetail,
  }).middleware(AuthMiddleware),
  Rpc.make("DataImportConfirm", {
    error: DataTransferServiceErrors,
    payload: DataImportConfirm,
    success: Schema.Void,
  }).middleware(AuthMiddleware),
  Rpc.make("DataImportCancel", {
    error: DataTransferServiceErrors,
    payload: DataImportCancel,
    success: Schema.Void,
  }).middleware(AuthMiddleware)
) {}

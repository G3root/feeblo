import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { AuthMiddleware } from "../session-middleware";
import { EmailSuppressionServiceErrors } from "./errors";
import {
  EmailSuppressionAddRequest,
  EmailSuppressionListRequest,
  EmailSuppressionListResult,
  EmailSuppressionRemoveRequest,
  EmailSuppressionStats,
  EmailSuppressionStatsRequest,
  EmailSuppressionSummary,
} from "./schema";

/**
 * Dashboard suppression management.
 *
 * The send path does not call these: it reads the same table directly. These
 * RPCs exist so a workspace can see why an address stopped receiving mail,
 * block an address an abuse report named, and lift a complaint it wrote
 * itself. They are the only tenant-facing way a row is created or removed.
 */
export class EmailSuppressionRpcs extends RpcGroup.make(
  Rpc.make("ListEmailSuppressions", {
    error: EmailSuppressionServiceErrors,
    payload: EmailSuppressionListRequest,
    success: EmailSuppressionListResult,
  }).middleware(AuthMiddleware),
  Rpc.make("AddEmailSuppression", {
    error: EmailSuppressionServiceErrors,
    payload: EmailSuppressionAddRequest,
    success: EmailSuppressionSummary,
  }).middleware(AuthMiddleware),
  Rpc.make("RemoveEmailSuppression", {
    error: EmailSuppressionServiceErrors,
    payload: EmailSuppressionRemoveRequest,
    success: Schema.Void,
  }).middleware(AuthMiddleware),
  Rpc.make("GetEmailSuppressionStats", {
    error: EmailSuppressionServiceErrors,
    payload: EmailSuppressionStatsRequest,
    success: EmailSuppressionStats,
  }).middleware(AuthMiddleware)
) {}

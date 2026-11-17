import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { AuditLogServiceErrors } from "./errors";
import { AuditLogListRequest, AuditLogPage } from "./schema";

/**
 * The workspace audit log, read-only.
 *
 * There is no write RPC and never should be: an entry is a by-product of the
 * action it records, written in that action's transaction. A surface that could
 * append or amend entries would be a surface that could rewrite the record.
 *
 * `AuthMiddleware` admits a session; the role gate (`auditLog.read`) lives in
 * the handler, and the Public API's equivalent is a later, separate contract
 * (ADR 0004) rather than a second consumer of this one.
 */
export class AuditLogRpcs extends RpcGroup.make(
  Rpc.make("ListAuditLogEntries", {
    error: AuditLogServiceErrors,
    payload: AuditLogListRequest,
    success: AuditLogPage,
  }).middleware(AuthMiddleware)
) {}

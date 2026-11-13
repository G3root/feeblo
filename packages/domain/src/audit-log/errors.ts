import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import { InternalServerError, UnauthorizedError } from "../rpc-errors";

/**
 * A stored audit row that could not be written or read back.
 *
 * The recorder's own failure, not the transport's: the repository maps every
 * database and decode problem into this, and the handler turns it into the
 * generic internal error so no driver detail reaches the client. It stays out
 * of `AuditLogServiceErrors` for the same reason — a caller has no branch for
 * it.
 */
export class AuditLogDataError extends Schema.TaggedError<AuditLogDataError>()(
  "AuditLogDataError",
  {
    operation: Schema.String,
    reason: Schema.String,
    cause: Schema.optionalKey(Schema.Defect()),
  }
) {}

/**
 * The dashboard's audit-log RPC errors.
 *
 * Reading the log is an administrator's view of every member's activity, so
 * the only interesting refusal is the role check. A persistence failure is
 * unexpected after that gate and travels as the generic internal error.
 */
export const AuditLogServiceErrors = Schema.Union([
  UnauthorizedError,
  PolicyDeniedError,
  InternalServerError,
]);

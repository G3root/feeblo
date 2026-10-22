import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

/**
 * Error surface of the dashboard's suppression management RPCs.
 *
 * `PolicyDeniedError` covers both refusals: a role without
 * `emailSuppressions.manage`, and an attempt to remove a row that belongs to
 * another workspace or to the platform. The generic internal error carries the
 * database failure, which after those gates is genuinely unexpected.
 */
export const EmailSuppressionServiceErrors = Schema.Union([
  UnauthorizedError,
  PolicyDeniedError,
  NotFoundError,
  BadRequestError,
  InternalServerError,
]);

import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

/**
 * Error surface of the dashboard's API-key management RPCs.
 *
 * `PolicyDeniedError` covers both gates: the `apiKeys.manage` permission and
 * the `publicApi` plan entitlement. The generic internal error carries the
 * plugin's own failures, which after those gates are genuinely unexpected.
 */
export const ApiKeyServiceErrors = Schema.Union([
  UnauthorizedError,
  PolicyDeniedError,
  NotFoundError,
  BadRequestError,
  InternalServerError,
]);

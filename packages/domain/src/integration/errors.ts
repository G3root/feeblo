import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

/** RPC error union for every webhook management operation. */
export const WebhookManagementErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PolicyDeniedError,
  UnauthorizedError,
]);
export type WebhookManagementError = typeof WebhookManagementErrors.Type;

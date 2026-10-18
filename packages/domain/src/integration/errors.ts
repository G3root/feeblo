import * as Schema from "effect/Schema";

import { PlanLockedError } from "../entitlement/errors";
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
  PlanLockedError,
  UnauthorizedError,
]);
export type WebhookManagementError = typeof WebhookManagementErrors.Type;

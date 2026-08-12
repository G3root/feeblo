import * as Schema from "effect/Schema";
import { PolicyDeniedError } from "../../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../../rpc-errors";

/** RPC error union for every Slack integration management operation. */
export const SlackIntegrationErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PolicyDeniedError,
  UnauthorizedError,
]);
export type SlackIntegrationError = typeof SlackIntegrationErrors.Type;

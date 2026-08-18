import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../../rpc-errors";

/** Internal inbound failure; surfaced to Slack as an ephemeral error. */
export class SlackInboundFailure extends Data.TaggedError(
  "SlackInboundFailure"
)<{
  readonly message: string;
}> {}

/** RPC error union for every Slack integration management operation. */
export const SlackIntegrationErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PolicyDeniedError,
  UnauthorizedError,
]);
export type SlackIntegrationError = typeof SlackIntegrationErrors.Type;

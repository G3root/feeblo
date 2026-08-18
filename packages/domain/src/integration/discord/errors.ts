import * as Data from "effect/Data";
import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../../rpc-errors";

/** Internal inbound failure; surfaced to Discord as an ephemeral message. */
export class DiscordInboundFailure extends Data.TaggedError(
  "DiscordInboundFailure"
)<{
  readonly message: string;
}> {}

/** RPC error union for every Discord integration management operation. */
export const DiscordIntegrationErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PolicyDeniedError,
  UnauthorizedError,
]);
export type DiscordIntegrationError = typeof DiscordIntegrationErrors.Type;

import * as Schema from "effect/Schema";

import { PolicyDeniedError } from "../../policy";
import {
  BadRequestError,
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../../rpc-errors";

/**
 * Internal inbound failure: the submission could not become a post.
 *
 * One failure type for every chat provider, because the failure does not
 * depend on which provider delivered the submission. How it is shown to the
 * person — a Slack ephemeral message, a Discord ephemeral reply — stays the
 * provider's decision, and the provider's inbound fallback renders a generic
 * message rather than this one.
 */
export class ChatInboundFailure extends Schema.TaggedError<ChatInboundFailure>()(
  "ChatInboundFailure",
  { message: Schema.String }
) {}

/** RPC error union for every chat integration management operation. */
export const ChatIntegrationErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PolicyDeniedError,
  UnauthorizedError,
]);
export type ChatIntegrationError = typeof ChatIntegrationErrors.Type;

import * as Schema from "effect/Schema";

import {
  InternalServerError,
  NotFoundError,
  UnauthorizedError,
} from "../rpc-errors";

/**
 * The failures the dashboard's widget-identity RPC publishes.
 *
 * `NotFoundError` is how the RPC reports that this deployment has no feedback
 * widget configured, and `InternalServerError` that the configured workspace
 * has no active signing secret. Both are operator states, not caller mistakes:
 * the dashboard swallows them and leaves the widget anonymous, which is why
 * neither is worth a dedicated tag the client has to know about.
 */
export const WidgetServiceErrors = Schema.Union([
  UnauthorizedError,
  NotFoundError,
  InternalServerError,
]);

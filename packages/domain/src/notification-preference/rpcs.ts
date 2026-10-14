import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import { InternalServerError } from "../rpc-errors";
import { AuthMiddleware } from "../session-middleware";
import {
  NotificationPreferenceQuery,
  NotificationPreferenceSetRequest,
  NotificationPreferenceState,
} from "./schema";

/** Errors every preference route can answer with. */
export const NotificationPreferenceErrors = Schema.Union([
  Policy.PolicyDeniedError,
  InternalServerError,
]);

/**
 * Per-member notification preferences for one workspace.
 *
 * Membership is the only gate: every role manages its own toggles, and there
 * is no route that writes another member's preferences.
 */
export class NotificationPreferenceRpcs extends RpcGroup.make(
  Rpc.make("NotificationPreferenceGet", {
    payload: NotificationPreferenceQuery,
    success: NotificationPreferenceState,
    error: NotificationPreferenceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("NotificationPreferenceSet", {
    payload: NotificationPreferenceSetRequest,
    success: NotificationPreferenceState,
    error: NotificationPreferenceErrors,
  }).middleware(AuthMiddleware)
) {}

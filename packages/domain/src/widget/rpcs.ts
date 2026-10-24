import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { WidgetServiceErrors } from "./errors";
import { FeedbackWidgetIdentity } from "./schema";

/**
 * The dashboard's half of the widget contract.
 *
 * The public HTTP surface (`api-contract.ts`) is what the iframe calls; this is
 * the session-authenticated call the host page makes to find out who its own
 * widget should submit as. It carries no payload on purpose: the audience
 * comes from `FEEDBACK_WIDGET_ORGANIZATION_ID` on the server, so a caller can
 * never ask for an identity token for a workspace of its choosing.
 */
export class WidgetRpcs extends RpcGroup.make(
  Rpc.make("GetFeedbackWidgetIdentity", {
    success: FeedbackWidgetIdentity,
    error: WidgetServiceErrors,
  }).middleware(AuthMiddleware)
) {}

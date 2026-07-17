import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import { Api } from "../http/api";
import { withRemapDbErrors } from "../rpc-errors";
import { applyUnsubscribe, inspectUnsubscribe } from "./unsubscribe";

export const NotificationApiLive = HttpApiBuilder.group(
  Api,
  "NotificationApiGroup",
  (handlers) =>
    handlers
      .handle("inspectUnsubscribe", ({ params }) =>
        inspectUnsubscribe(params.token).pipe(
          withRemapDbErrors("Notification", "select")
        )
      )
      .handle("applyUnsubscribe", ({ params }) =>
        applyUnsubscribe(params.token).pipe(
          withRemapDbErrors("Notification", "select")
        )
      )
);

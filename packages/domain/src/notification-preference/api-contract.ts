import * as HttpApiEndpoint from "effect/http-api/HttpApiEndpoint";
import * as HttpApiGroup from "effect/http-api/HttpApiGroup";
import * as Schema from "effect/Schema";

import { RateLimitErrors } from "../rate-limit";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import {
  NotificationPreferenceUnsubscribeAccepted,
  NotificationPreferenceUnsubscribeLinkAccepted,
  NotificationPreferenceUnsubscribeTokenRequest,
} from "./schema";

const NotificationPreferenceLinkErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
  RateLimitErrors,
]);

/** Public member-preference links embedded in notification email. */
export class NotificationPreferenceApiGroup extends HttpApiGroup.make(
  "NotificationPreferenceApiGroup"
)
  .add(
    HttpApiEndpoint.get(
      "unsubscribeNotificationPreferenceLink",
      "/notification-preferences/unsubscribe",
      {
        error: NotificationPreferenceLinkErrors,
        query: NotificationPreferenceUnsubscribeTokenRequest,
        success: NotificationPreferenceUnsubscribeLinkAccepted,
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "unsubscribeNotificationPreference",
      "/notification-preferences/unsubscribe",
      {
        error: NotificationPreferenceLinkErrors,
        query: NotificationPreferenceUnsubscribeTokenRequest,
        success: NotificationPreferenceUnsubscribeAccepted,
      }
    )
  ) {}

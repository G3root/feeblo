import * as Schema from "effect/Schema";
import * as HttpApiEndpoint from "effect/unstable/httpapi/HttpApiEndpoint";
import * as HttpApiGroup from "effect/unstable/httpapi/HttpApiGroup";
import { BadRequestError, InternalServerError } from "../rpc-errors";
import {
  EmailSubscriptionTokenRequest,
  EmailSubscriptionUnsubscribeAccepted,
  EmailSubscriptionVerificationAccepted,
} from "./schema";

const EmailSubscriptionLinkErrors = Schema.Union([
  BadRequestError,
  InternalServerError,
]);

/** Public HTTP links embedded in verification and one-click unsubscribe email. */
export class EmailSubscriptionApiGroup extends HttpApiGroup.make(
  "EmailSubscriptionApiGroup"
)
  .add(
    HttpApiEndpoint.get(
      "verifyEmailSubscription",
      "/email-subscriptions/verify",
      {
        error: EmailSubscriptionLinkErrors,
        query: EmailSubscriptionTokenRequest,
        success: EmailSubscriptionVerificationAccepted,
      }
    )
  )
  .add(
    HttpApiEndpoint.get(
      "unsubscribeEmailSubscriptionLink",
      "/email-subscriptions/unsubscribe",
      {
        error: EmailSubscriptionLinkErrors,
        query: EmailSubscriptionTokenRequest,
        success: EmailSubscriptionUnsubscribeAccepted,
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "unsubscribeEmailSubscription",
      "/email-subscriptions/unsubscribe",
      {
        error: EmailSubscriptionLinkErrors,
        query: EmailSubscriptionTokenRequest,
        success: EmailSubscriptionUnsubscribeAccepted,
      }
    )
  ) {}

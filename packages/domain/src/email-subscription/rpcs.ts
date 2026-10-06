import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { InternalServerError } from "../rpc-errors";
import { AuthMiddleware } from "../session-middleware";
import {
  ChangelogSubscriptionRequest,
  EmailSubscriptionRequestAccepted,
  EmailSubscriptionTokenRequest,
  EmailSubscriptionUnsubscribeAccepted,
  EmailSubscriptionVerificationAccepted,
  SubmissionNotificationPreferenceQuery,
  SubmissionNotificationPreferenceRequest,
  SubmissionNotificationPreferenceState,
} from "./schema";

const EmailSubscriptionPublicErrors = Schema.Union([
  Policy.PolicyDeniedError,
  RateLimitErrors,
  InternalServerError,
]);

/** Public consent endpoints; their responses never include link tokens. */
export class EmailSubscriptionRpcs extends RpcGroup.make(
  Rpc.make("EmailSubscriptionChangelogSubscribePublic", {
    payload: ChangelogSubscriptionRequest,
    success: EmailSubscriptionRequestAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("EmailSubscriptionVerifyPublic", {
    payload: EmailSubscriptionTokenRequest,
    success: EmailSubscriptionVerificationAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("EmailSubscriptionUnsubscribePublic", {
    payload: EmailSubscriptionTokenRequest,
    success: EmailSubscriptionUnsubscribeAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("EmailSubmissionNotificationPreferenceGet", {
    payload: SubmissionNotificationPreferenceQuery,
    success: SubmissionNotificationPreferenceState,
    error: EmailSubscriptionPublicErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("EmailSubmissionNotificationPreferenceSet", {
    payload: SubmissionNotificationPreferenceRequest,
    success: SubmissionNotificationPreferenceState,
    error: EmailSubscriptionPublicErrors,
  }).middleware(AuthMiddleware)
) {}

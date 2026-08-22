import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import * as Policy from "../policy";
import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { InternalServerError } from "../rpc-errors";
import { AuthMiddleware } from "../session-middleware";
import {
  ChangelogSubscriptionRequest,
  ChangelogSubscriptionSetRequest,
  ChangelogSubscriptionStateAccepted,
  ChangelogSubscriptionStatusRequest,
  EmailSubscriptionRequestAccepted,
  EmailSubscriptionTokenRequest,
  EmailSubscriptionUnsubscribeAccepted,
  EmailSubscriptionVerificationAccepted,
  SubmissionNotificationPreferenceAccepted,
  SubmissionNotificationPreferenceRequest,
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
  Rpc.make("EmailSubscriptionChangelogStatusGet", {
    payload: ChangelogSubscriptionStatusRequest,
    success: ChangelogSubscriptionStateAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("EmailSubscriptionChangelogSubscribeSet", {
    payload: ChangelogSubscriptionSetRequest,
    success: ChangelogSubscriptionStateAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("EmailSubmissionNotificationPreferenceSet", {
    payload: SubmissionNotificationPreferenceRequest,
    success: SubmissionNotificationPreferenceAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(AuthMiddleware)
) {}

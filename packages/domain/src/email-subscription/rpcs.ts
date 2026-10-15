import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import * as Policy from "../policy";
import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { InternalServerError } from "../rpc-errors";
import {
  ChangelogSubscriptionRequest,
  EmailSubscriptionRequestAccepted,
  EmailSubscriptionTokenRequest,
  EmailSubscriptionUnsubscribeAccepted,
  EmailSubscriptionVerificationAccepted,
} from "./schema";

const EmailSubscriptionPublicErrors = Schema.Union([
  Policy.PolicyDeniedError,
  RateLimitErrors,
  InternalServerError,
]);

/** Public consent endpoints; their responses never include link tokens. */
export class EmailSubscriptionRpcs extends RpcGroup.make(
  Rpc.make("SubscribeEmailSubscriptionPublic", {
    payload: ChangelogSubscriptionRequest,
    success: EmailSubscriptionRequestAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("VerifyEmailSubscriptionPublic", {
    payload: EmailSubscriptionTokenRequest,
    success: EmailSubscriptionVerificationAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("UnsubscribeEmailSubscriptionPublic", {
    payload: EmailSubscriptionTokenRequest,
    success: EmailSubscriptionUnsubscribeAccepted,
    error: EmailSubscriptionPublicErrors,
  }).middleware(PublicRpcRateLimitMiddleware)
) {}

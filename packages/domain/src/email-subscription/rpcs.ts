import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import * as Policy from "../policy";
import {
  PublicRpcRateLimitMiddleware,
  RateLimitErrors,
} from "../rate-limit";
import { InternalServerError } from "../rpc-errors";
import {
  ChangelogSubscriptionRequest,
  EmailSubscriptionDataError,
  EmailSubscriptionInputError,
  EmailSubscriptionRequestAccepted,
  EmailSubscriptionTokenRequest,
  EmailSubscriptionUnsubscribeAccepted,
  EmailSubscriptionVerificationAccepted,
} from "./schema";
import { EmailSubscriptionTokenError } from "./tokens";

const EmailSubscriptionPublicErrors = Schema.Union([
  EmailSubscriptionDataError,
  EmailSubscriptionInputError,
  EmailSubscriptionTokenError,
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
  }).middleware(PublicRpcRateLimitMiddleware)
) {}

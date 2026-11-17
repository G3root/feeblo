import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { HelpCenterArticleFeedbackServiceErrors } from "./errors";
import {
  HelpCenterArticleFeedback,
  HelpCenterArticleFeedbackCast,
  HelpCenterArticleFeedbackGetPublic,
  HelpCenterArticleFeedbackList,
  HelpCenterArticleFeedbackPublic,
} from "./schema";

/**
 * "Was this helpful?" on both RPC surfaces.
 *
 * The portal's two reads take an optional `visitorId` because most readers are
 * not signed in. The dashboard's list is manager-scoped: an unhelpful vote
 * carrying a reason is feedback about the documentation, and reading it is
 * reviewing, not reading.
 */
export class HelpCenterArticleFeedbackRpcs extends RpcGroup.make(
  Rpc.make("GetHelpCenterArticleFeedbackPublic", {
    payload: HelpCenterArticleFeedbackGetPublic,
    success: HelpCenterArticleFeedbackPublic,
    error: Schema.Union([
      HelpCenterArticleFeedbackServiceErrors,
      RateLimitErrors,
    ]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("SetHelpCenterArticleFeedback", {
    payload: HelpCenterArticleFeedbackCast,
    success: HelpCenterArticleFeedbackPublic,
    error: Schema.Union([
      HelpCenterArticleFeedbackServiceErrors,
      RateLimitErrors,
    ]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("ListHelpCenterArticleFeedback", {
    payload: HelpCenterArticleFeedbackList,
    success: Schema.Array(HelpCenterArticleFeedback),
    error: HelpCenterArticleFeedbackServiceErrors,
  }).middleware(AuthMiddleware)
) {}

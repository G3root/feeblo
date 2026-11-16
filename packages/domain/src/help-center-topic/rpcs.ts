import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { HelpCenterTopicServiceErrors } from "./errors";
import {
  HelpCenterTopicCreate,
  HelpCenterTopicDelete,
  HelpCenterTopicList,
  HelpCenterTopicReorder,
  HelpCenterTopicUpdate,
  HelpCenterTopicWithCount,
} from "./schema";

/**
 * The help center's topic vocabulary, on both RPC surfaces.
 *
 * The `Public` reads are the portal's and count only published articles; the
 * others are the dashboard's and see everything. Both return the same shape,
 * because the surface that reads it is what decides which numbers are honest —
 * not two schemas that would drift.
 */
export class HelpCenterTopicRpcs extends RpcGroup.make(
  Rpc.make("ListHelpCenterTopics", {
    payload: HelpCenterTopicList,
    success: Schema.Array(HelpCenterTopicWithCount),
    error: HelpCenterTopicServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListHelpCenterTopicsPublic", {
    payload: HelpCenterTopicList,
    success: Schema.Array(HelpCenterTopicWithCount),
    error: Schema.Union([HelpCenterTopicServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("CreateHelpCenterTopic", {
    payload: HelpCenterTopicCreate,
    success: Schema.Void,
    error: HelpCenterTopicServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpdateHelpCenterTopic", {
    payload: HelpCenterTopicUpdate,
    success: Schema.Void,
    error: HelpCenterTopicServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("DeleteHelpCenterTopic", {
    payload: HelpCenterTopicDelete,
    success: Schema.Void,
    error: HelpCenterTopicServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ReorderHelpCenterTopics", {
    payload: HelpCenterTopicReorder,
    success: Schema.Void,
    error: HelpCenterTopicServiceErrors,
  }).middleware(AuthMiddleware)
) {}

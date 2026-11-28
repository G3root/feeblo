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
  HelpCenterTopicPublic,
  HelpCenterTopicReorder,
  HelpCenterTopicUpdate,
  HelpCenterTopicWithCount,
} from "./schema";

/**
 * The help center's topic vocabulary, on both RPC surfaces.
 *
 * The `Public` read is the portal's and counts only published articles, so it
 * answers with `HelpCenterTopicPublic` — the section with no article count. The
 * dashboard's read answers with `HelpCenterTopicWithCount`, because the
 * dashboard is the one surface that renders the number.
 */
export class HelpCenterTopicRpcs extends RpcGroup.make(
  Rpc.make("ListHelpCenterTopics", {
    payload: HelpCenterTopicList,
    success: Schema.Array(HelpCenterTopicWithCount),
    error: HelpCenterTopicServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListHelpCenterTopicsPublic", {
    payload: HelpCenterTopicList,
    success: Schema.Array(HelpCenterTopicPublic),
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

import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { ReactionServiceErrors } from "../reaction/errors";
import { ReactionList, ReactionToggleResult } from "../reaction/schema";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { PostReaction, PostReactionToggle } from "./schema";

export class PostReactionRpcs extends RpcGroup.make(
  Rpc.make("ListPostReactions", {
    payload: ReactionList,
    success: Schema.Array(PostReaction),
    error: ReactionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("TogglePostReaction", {
    payload: PostReactionToggle,
    success: ReactionToggleResult,
    error: ReactionServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("ListPostReactionsPublic", {
    payload: ReactionList,
    success: Schema.Array(PostReaction),
    error: Schema.Union([ReactionServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("TogglePostReactionPublic", {
    payload: PostReactionToggle,
    success: ReactionToggleResult,
    error: Schema.Union([ReactionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

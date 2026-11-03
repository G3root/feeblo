import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { ReactionServiceErrors } from "../reaction/errors";
import { ReactionList, ReactionToggleResult } from "../reaction/schema";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { CommentReaction, CommentReactionToggle } from "./schema";

export class CommentReactionRpcs extends RpcGroup.make(
  Rpc.make("ListCommentReactions", {
    payload: ReactionList,
    success: Schema.Array(CommentReaction),
    error: ReactionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ToggleCommentReaction", {
    payload: CommentReactionToggle,
    success: ReactionToggleResult,
    error: ReactionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListCommentReactionsPublic", {
    payload: ReactionList,
    success: Schema.Array(CommentReaction),
    error: Schema.Union([ReactionServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("ToggleCommentReactionPublic", {
    payload: CommentReactionToggle,
    success: ReactionToggleResult,
    error: Schema.Union([ReactionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { CommentServiceErrors } from "./errors";
import {
  Comment,
  CommentCreate,
  CommentDelete,
  CommentList,
  CommentPin,
  CommentUnpin,
  CommentUpdate,
} from "./schema";

export class CommentRpcs extends RpcGroup.make(
  Rpc.make("ListComments", {
    success: Schema.Array(Comment),
    error: CommentServiceErrors,
    payload: CommentList,
  }).middleware(AuthMiddleware),
  Rpc.make("ListCommentsPublic", {
    success: Schema.Array(Comment),
    error: Schema.Union([CommentServiceErrors, RateLimitErrors]),
    payload: CommentList,
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreateComment", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    // On-behalf creates consume the per-member dashboard rate limit.
    error: Schema.Union([CommentServiceErrors, RateLimitErrors]),
    payload: CommentCreate,
  }).middleware(AuthMiddleware),
  Rpc.make("CreateCommentPublic", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: Schema.Union([CommentServiceErrors, RateLimitErrors]),
    payload: CommentCreate,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("DeleteComment", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: CommentServiceErrors,
    payload: CommentDelete,
  }).middleware(AuthMiddleware),
  Rpc.make("DeleteCommentPublic", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: Schema.Union([CommentServiceErrors, RateLimitErrors]),
    payload: CommentDelete,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("UpdateComment", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: CommentServiceErrors,
    payload: CommentUpdate,
  }).middleware(AuthMiddleware),
  Rpc.make("UpdateCommentPublic", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: Schema.Union([CommentServiceErrors, RateLimitErrors]),
    payload: CommentUpdate,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("PinComment", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: CommentServiceErrors,
    payload: CommentPin,
  }).middleware(AuthMiddleware),
  Rpc.make("UnpinComment", {
    success: Schema.Struct({
      message: Schema.String,
    }),
    error: CommentServiceErrors,
    payload: CommentUnpin,
  }).middleware(AuthMiddleware)
) {}

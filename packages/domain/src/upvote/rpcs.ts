import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { UpvoteServiceErrors } from "./errors";
import { Upvote, UpvoteList, UpvoteToggle } from "./schema";

export class UpvoteRpcs extends RpcGroup.make(
  Rpc.make("UpvoteList", {
    payload: UpvoteList,
    success: Schema.Array(Upvote),
    error: UpvoteServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("UpvoteToggle", {
    payload: UpvoteToggle,
    success: Schema.Struct({
      upvoted: Schema.Boolean,
    }),
    error: UpvoteServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("UpvoteListPublic", {
    payload: UpvoteList,
    success: Schema.Array(Upvote),
    error: Schema.Union([UpvoteServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("UpvoteTogglePublic", {
    payload: UpvoteToggle,
    success: Schema.Struct({
      upvoted: Schema.Boolean,
    }),
    error: Schema.Union([UpvoteServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

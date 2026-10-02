import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware } from "../session-middleware";
import { PostStatusServiceErrors } from "./errors";
import { PostStatus, PostStatusList } from "./schema";

export class PostStatusRpcs extends RpcGroup.make(
  Rpc.make("PostStatusList", {
    success: Schema.Array(PostStatus),
    payload: PostStatusList,
    error: PostStatusServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("PostStatusListPublic", {
    success: Schema.Array(PostStatus),
    payload: PostStatusList,
    error: Schema.Union([PostStatusServiceErrors, RateLimitErrors]),
  }).middleware(PublicRpcRateLimitMiddleware)
) {}

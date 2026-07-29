import * as Schema from "effect/Schema";

import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";
import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { PostServiceErrors } from "./errors";
import {
  Post,
  PostAdminUpdate,
  PostCreate,
  PostDelete,
  PostDeletePublic,
  PostList,
  PostMerge,
  PostUpdate,
} from "./schema";

export class PostRpcs extends RpcGroup.make(
  Rpc.make("PostList", {
    payload: PostList,
    success: Schema.Array(Post),
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostListPublic", {
    payload: PostList,
    success: Schema.Array(Post),
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostCreate", {
    success: Schema.Void,
    payload: PostCreate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostCreatePublic", {
    success: Schema.Void,
    payload: PostCreate,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostDelete", {
    success: Schema.Void,
    payload: PostDelete,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostDeletePublic", {
    success: Schema.Void,
    payload: PostDeletePublic,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostUpdate", {
    success: Schema.Void,
    payload: PostUpdate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostUpdatePublic", {
    success: Schema.Void,
    payload: PostUpdate,
    error: Schema.Union([PostServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),

  Rpc.make("PostAdminUpdate", {
    success: Schema.Void,
    payload: PostAdminUpdate,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware),

  Rpc.make("PostMerge", {
    success: Schema.Void,
    payload: PostMerge,
    error: PostServiceErrors,
  }).middleware(AuthMiddleware)
) {}

import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, OptionalAuthMiddleware } from "../session-middleware";
import { ChangelogPostServiceErrors } from "./errors";
import {
  ChangelogPost,
  ChangelogPostCreate,
  ChangelogPostDelete,
  ChangelogPostList,
} from "./schema";

export class ChangelogPostRpcs extends RpcGroup.make(
  Rpc.make("ListChangelogPosts", {
    payload: ChangelogPostList,
    success: Schema.Array(ChangelogPost),
    error: ChangelogPostServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListChangelogPostsPublic", {
    payload: ChangelogPostList,
    success: Schema.Array(ChangelogPost),
    error: Schema.Union([ChangelogPostServiceErrors, RateLimitErrors]),
  })
    .middleware(OptionalAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreateChangelogPost", {
    payload: ChangelogPostCreate,
    success: Schema.Void,
    error: ChangelogPostServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeleteChangelogPost", {
    payload: ChangelogPostDelete,
    success: Schema.Void,
    error: ChangelogPostServiceErrors,
  }).middleware(AuthMiddleware)
) {}

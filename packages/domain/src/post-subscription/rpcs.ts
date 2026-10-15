import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, PublicAuthMiddleware } from "../session-middleware";
import { PostSubscriptionServiceErrors } from "./errors";
import {
  PostSubscription,
  PostSubscriptionCreate,
  PostSubscriptionDelete,
  PostSubscriptionList,
} from "./schema";

export class PostSubscriptionRpcs extends RpcGroup.make(
  Rpc.make("ListPostSubscriptions", {
    payload: PostSubscriptionList,
    success: Schema.Array(PostSubscription),
    error: PostSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ListPostSubscriptionsPublic", {
    payload: PostSubscriptionList,
    success: Schema.Array(PostSubscription),
    error: Schema.Union([PostSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreatePostSubscription", {
    payload: PostSubscriptionCreate,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: PostSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("CreatePostSubscriptionPublic", {
    payload: PostSubscriptionCreate,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([PostSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("DeletePostSubscription", {
    payload: PostSubscriptionDelete,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: PostSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("DeletePostSubscriptionPublic", {
    payload: PostSubscriptionDelete,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([PostSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

import * as Schema from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware } from "../session-middleware";
import { ChangelogSubscriptionServiceErrors } from "./errors";
import {
  ChangelogSubscription,
  ChangelogSubscriptionCreate,
  ChangelogSubscriptionDelete,
  ChangelogSubscriptionList,
} from "./schema";

export class ChangelogSubscriptionRpcs extends RpcGroup.make(
  Rpc.make("ChangelogSubscriptionList", {
    payload: ChangelogSubscriptionList,
    success: Schema.Array(ChangelogSubscription),
    error: ChangelogSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ChangelogSubscriptionListPublic", {
    payload: ChangelogSubscriptionList,
    success: Schema.Array(ChangelogSubscription),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("ChangelogSubscriptionCreate", {
    payload: ChangelogSubscriptionCreate,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: ChangelogSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ChangelogSubscriptionCreatePublic", {
    payload: ChangelogSubscriptionCreate,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("ChangelogSubscriptionDelete", {
    payload: ChangelogSubscriptionDelete,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: ChangelogSubscriptionServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("ChangelogSubscriptionDeletePublic", {
    payload: ChangelogSubscriptionDelete,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

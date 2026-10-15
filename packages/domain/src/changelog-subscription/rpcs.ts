import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as Schema from "effect/Schema";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, PublicAuthMiddleware } from "../session-middleware";
import { ChangelogSubscriptionServiceErrors } from "./errors";
import {
  ChangelogSubscription,
  ChangelogSubscriptionCreate,
  ChangelogSubscriptionDelete,
  ChangelogSubscriptionList,
} from "./schema";

export class ChangelogSubscriptionRpcs extends RpcGroup.make(
  Rpc.make("ListChangelogSubscriptions", {
    payload: ChangelogSubscriptionList,
    success: Schema.Array(ChangelogSubscription),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("ListChangelogSubscriptionsPublic", {
    payload: ChangelogSubscriptionList,
    success: Schema.Array(ChangelogSubscription),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    // Admits SSO-restricted sessions; the handler authorizes them per
    // organization via Policy.hasRestrictedOrganizationScope.
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreateChangelogSubscription", {
    payload: ChangelogSubscriptionCreate,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CreateChangelogSubscriptionPublic", {
    payload: ChangelogSubscriptionCreate,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("DeleteChangelogSubscription", {
    payload: ChangelogSubscriptionDelete,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("DeleteChangelogSubscriptionPublic", {
    payload: ChangelogSubscriptionDelete,
    success: Schema.Struct({
      subscribed: Schema.Boolean,
    }),
    error: Schema.Union([ChangelogSubscriptionServiceErrors, RateLimitErrors]),
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

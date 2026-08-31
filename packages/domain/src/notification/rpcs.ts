import * as S from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware, PublicAuthMiddleware } from "../session-middleware";
import { NotificationServiceErrors } from "./errors";
import {
  Notification,
  NotificationList,
  NotificationMarkAllRead,
  NotificationMarkRead,
  NotificationUnreadCount,
} from "./schema";

const NotificationPublicErrors = S.Union([
  NotificationServiceErrors,
  RateLimitErrors,
]);

export class NotificationRpcs extends RpcGroup.make(
  Rpc.make("NotificationList", {
    payload: NotificationList,
    success: S.Array(Notification),
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationUnreadCount", {
    payload: NotificationUnreadCount,
    success: S.Struct({ count: S.Number }),
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationMarkRead", {
    payload: NotificationMarkRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationMarkAllRead", {
    payload: NotificationMarkAllRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  // Public-board variants for signed-in end users, who may not be workspace
  // members. Results are always scoped to the session user id. SSO-restricted
  // sessions are authorized per-organization by the handlers' restricted-scope
  // policy, so they must pass auth instead of being rejected by middleware.
  Rpc.make("NotificationListPublic", {
    payload: NotificationList,
    success: S.Array(Notification),
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationUnreadCountPublic", {
    payload: NotificationUnreadCount,
    success: S.Struct({ count: S.Number }),
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationMarkReadPublic", {
    payload: NotificationMarkRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationMarkAllReadPublic", {
    payload: NotificationMarkAllRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

import * as Rpc from "effect/rpc/Rpc";
import * as RpcGroup from "effect/rpc/RpcGroup";
import * as S from "effect/Schema";

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
  Rpc.make("ListNotifications", {
    payload: NotificationList,
    success: S.Array(Notification),
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CountUnreadNotifications", {
    payload: NotificationUnreadCount,
    success: S.Struct({ count: S.Finite }),
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("MarkNotificationRead", {
    payload: NotificationMarkRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("MarkAllNotificationsRead", {
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
  Rpc.make("ListNotificationsPublic", {
    payload: NotificationList,
    success: S.Array(Notification),
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("CountUnreadNotificationsPublic", {
    payload: NotificationUnreadCount,
    success: S.Struct({ count: S.Finite }),
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("MarkNotificationReadPublic", {
    payload: NotificationMarkRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("MarkAllNotificationsReadPublic", {
    payload: NotificationMarkAllRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(PublicAuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

import * as S from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { PublicRpcRateLimitMiddleware, RateLimitErrors } from "../rate-limit";
import { AuthMiddleware } from "../session-middleware";
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
    error: NotificationServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("NotificationUnreadCount", {
    payload: NotificationUnreadCount,
    success: S.Struct({ count: S.Number }),
    error: NotificationServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("NotificationMarkRead", {
    payload: NotificationMarkRead,
    success: S.Void,
    error: NotificationServiceErrors,
  }).middleware(AuthMiddleware),
  Rpc.make("NotificationMarkAllRead", {
    payload: NotificationMarkAllRead,
    success: S.Void,
    error: NotificationServiceErrors,
  }).middleware(AuthMiddleware),
  // Public-board variants for signed-in end users, who may not be workspace
  // members. Results are always scoped to the session user id.
  Rpc.make("NotificationListPublic", {
    payload: NotificationList,
    success: S.Array(Notification),
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationUnreadCountPublic", {
    payload: NotificationUnreadCount,
    success: S.Struct({ count: S.Number }),
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationMarkReadPublic", {
    payload: NotificationMarkRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware),
  Rpc.make("NotificationMarkAllReadPublic", {
    payload: NotificationMarkAllRead,
    success: S.Void,
    error: NotificationPublicErrors,
  })
    .middleware(AuthMiddleware)
    .middleware(PublicRpcRateLimitMiddleware)
) {}

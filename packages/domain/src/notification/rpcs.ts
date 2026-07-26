import * as S from "effect/Schema";
import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { AuthMiddleware } from "../session-middleware";
import { NotificationServiceErrors } from "./errors";
import {
  Notification,
  NotificationList,
  NotificationMarkAllRead,
  NotificationMarkRead,
  NotificationUnreadCount,
} from "./schema";

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
  }).middleware(AuthMiddleware)
) {}

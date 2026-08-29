import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { NotificationPolicy } from "./policies";
import { NotificationRpcs } from "./rpcs";
import type { TNotificationList, TNotificationMarkRead } from "./schema";
import { NotificationService } from "./service";

export const NotificationRpcHandlersEffect = Effect.gen(function* () {
  const notifications = yield* NotificationService;
  const notificationPolicy = yield* NotificationPolicy;

  // -- Shared effect helpers (no policy applied) --

  const listNotificationsEffect = (args: TNotificationList) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      return yield* notifications.list({
        ...(args.cursor === undefined ? undefined : { cursor: args.cursor }),
        ...(args.limit === undefined ? undefined : { limit: args.limit }),
        organizationId: args.organizationId,
        recipientUserId: session.session.userId,
      });
    });

  const unreadCountEffect = ({ organizationId }: { organizationId: string }) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const count = yield* notifications.unreadCount({
        organizationId,
        recipientUserId: session.session.userId,
      });
      return { count };
    });

  const markReadEffect = (args: TNotificationMarkRead) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      yield* notifications.markRead({
        id: args.notificationId,
        organizationId: args.organizationId,
        recipientUserId: session.session.userId,
      });
    });

  const markAllReadEffect = ({ organizationId }: { organizationId: string }) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      yield* notifications.markAllRead({
        organizationId,
        recipientUserId: session.session.userId,
      });
    });

  return {
    NotificationList: (args: TNotificationList) =>
      listNotificationsEffect(args).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(args.organizationId)),
        withRemapDbErrors("Notification", "select")
      ),
    NotificationUnreadCount: ({ organizationId }: { organizationId: string }) =>
      unreadCountEffect({ organizationId }).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(organizationId)),
        withRemapDbErrors("Notification", "select")
      ),
    NotificationMarkRead: (args: TNotificationMarkRead) =>
      markReadEffect(args).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(args.organizationId)),
        withRemapDbErrors("Notification", "update")
      ),
    NotificationMarkAllRead: ({ organizationId }: { organizationId: string }) =>
      markAllReadEffect({ organizationId }).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(organizationId)),
        withRemapDbErrors("Notification", "update")
      ),
    // Public-board variants for signed-in end users, who may not be workspace
    // members. Every query is scoped to the session user id, so results can
    // never leak another user's inbox.
    NotificationListPublic: (args: TNotificationList) =>
      listNotificationsEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "NotificationListPublic",
          level: "read",
        }),
        Policy.withPolicy(
          Policy.hasRestrictedOrganizationScope(args.organizationId)
        ),
        withRemapDbErrors("Notification", "select")
      ),
    NotificationUnreadCountPublic: ({
      organizationId,
    }: {
      organizationId: string;
    }) =>
      unreadCountEffect({ organizationId }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "NotificationUnreadCountPublic",
          level: "read",
        }),
        Policy.withPolicy(
          Policy.hasRestrictedOrganizationScope(organizationId)
        ),
        withRemapDbErrors("Notification", "select")
      ),
    NotificationMarkReadPublic: (args: TNotificationMarkRead) =>
      markReadEffect(args).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "NotificationMarkReadPublic",
          level: "write",
        }),
        Policy.withPolicy(
          Policy.hasRestrictedOrganizationScope(args.organizationId)
        ),
        withRemapDbErrors("Notification", "update")
      ),
    NotificationMarkAllReadPublic: ({
      organizationId,
    }: {
      organizationId: string;
    }) =>
      markAllReadEffect({ organizationId }).pipe(
        RateLimit.withPublicRpcRateLimit({
          name: "NotificationMarkAllReadPublic",
          level: "write",
        }),
        Policy.withPolicy(
          Policy.hasRestrictedOrganizationScope(organizationId)
        ),
        withRemapDbErrors("Notification", "update")
      ),
  };
});

export const NotificationRpcHandlers = NotificationRpcs.toLayer(
  NotificationRpcHandlersEffect
).pipe(
  Layer.provide(NotificationPolicy.layer),
  Layer.provide(NotificationService.layer)
);

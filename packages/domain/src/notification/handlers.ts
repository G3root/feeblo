import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import { defineSurfacePair } from "../surface";
import { NotificationPolicy } from "./policies";
import { NotificationRpcs } from "./rpcs";
import type { TNotificationList, TNotificationMarkRead } from "./schema";
import { NotificationService } from "./service";

/** The RPCs this group declares; a surface pair's operation must be one. */
type NotificationRpcTag = RpcTagsOf<typeof NotificationRpcs>;

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

  // -- Surface-parameterized writes --
  //
  // Both surfaces spend the same write limit and scope the query to the
  // session user; only the admission differs — a member on the dashboard, a
  // restricted widget session on the portal.

  const markReadWrite = defineSurfacePair<
    TNotificationMarkRead,
    NotificationRpcTag
  >()({
    operation: "NotificationMarkRead",
    remap: { action: "update", entity: "Notification" },
    dashboard: {
      rateLimit: "write",
      policy: (args: TNotificationMarkRead) =>
        notificationPolicy.canAccess(args.organizationId),
    },
    public: {
      rateLimit: "write",
      policy: (args: TNotificationMarkRead) =>
        Policy.hasRestrictedOrganizationScope(args.organizationId),
    },
  });

  const markAllReadWrite = defineSurfacePair<
    { organizationId: string },
    NotificationRpcTag
  >()({
    operation: "NotificationMarkAllRead",
    remap: { action: "update", entity: "Notification" },
    dashboard: {
      rateLimit: "write",
      policy: ({ organizationId }: { organizationId: string }) =>
        notificationPolicy.canAccess(organizationId),
    },
    public: {
      rateLimit: "write",
      policy: ({ organizationId }: { organizationId: string }) =>
        Policy.hasRestrictedOrganizationScope(organizationId),
    },
  });

  const markRead = markReadWrite.handlers((_surface, args) =>
    markReadEffect(args)
  );

  const markAllRead = markAllReadWrite.handlers((_surface, args) =>
    markAllReadEffect(args)
  );

  // -- Surface-parameterized reads --
  //
  // Every query is scoped to the session user id, so results can never leak
  // another user's inbox; only the admission differs — a member on the
  // dashboard, a restricted widget session on the portal.

  const listRead = defineSurfacePair<TNotificationList, NotificationRpcTag>()({
    operation: "NotificationList",
    remap: { action: "select", entity: "Notification" },
    dashboard: {
      rateLimit: "read",
      policy: (args: TNotificationList) =>
        notificationPolicy.canAccess(args.organizationId),
    },
    public: {
      rateLimit: "read",
      policy: (args: TNotificationList) =>
        Policy.hasRestrictedOrganizationScope(args.organizationId),
    },
  });

  const unreadCountRead = defineSurfacePair<
    { organizationId: string },
    NotificationRpcTag
  >()({
    operation: "NotificationUnreadCount",
    remap: { action: "select", entity: "Notification" },
    dashboard: {
      rateLimit: "read",
      policy: ({ organizationId }: { organizationId: string }) =>
        notificationPolicy.canAccess(organizationId),
    },
    public: {
      rateLimit: "read",
      policy: ({ organizationId }: { organizationId: string }) =>
        Policy.hasRestrictedOrganizationScope(organizationId),
    },
  });

  const list = listRead.handlers((_surface, args) =>
    listNotificationsEffect(args)
  );

  const unreadCount = unreadCountRead.handlers((_surface, args) =>
    unreadCountEffect(args)
  );

  return {
    NotificationList: list.dashboard,
    NotificationUnreadCount: unreadCount.dashboard,
    NotificationMarkRead: markRead.dashboard,
    NotificationMarkAllRead: markAllRead.dashboard,
    // Public-board variants for signed-in end users, who may not be workspace
    // members. Every query is scoped to the session user id, so results can
    // never leak another user's inbox.
    NotificationListPublic: list.public,
    NotificationUnreadCountPublic: unreadCount.public,
    NotificationMarkReadPublic: markRead.public,
    NotificationMarkAllReadPublic: markAllRead.public,
  };
});

export const NotificationRpcHandlers = NotificationRpcs.toLayer(
  NotificationRpcHandlersEffect
).pipe(
  Layer.provide(NotificationPolicy.layer),
  Layer.provide(NotificationService.layer)
);

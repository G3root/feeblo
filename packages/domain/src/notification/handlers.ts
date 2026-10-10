import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import * as RateLimit from "../rate-limit";
import { withRemapDbErrors } from "../rpc-errors";
import type { RpcTagsOf } from "../rpc-group";
import { CurrentSession } from "../session-middleware";
import {
  type Surface,
  type SurfacePair,
  withSurfaceRateLimit,
} from "../surface";
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

  const markReadWrite = {
    operation: "NotificationMarkRead",
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
  } satisfies SurfacePair<TNotificationMarkRead, NotificationRpcTag>;

  const markAllReadWrite = {
    operation: "NotificationMarkAllRead",
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
  } satisfies SurfacePair<{ organizationId: string }, NotificationRpcTag>;

  const markReadFor = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: TNotificationMarkRead
  ) =>
    markReadEffect(args).pipe(
      Policy.withPolicy(markReadWrite[surface].policy(args)),
      withRemapDbErrors("Notification", "update"),
      withSurfaceRateLimit({
        level,
        operation: markReadWrite.operation,
        surface,
      })
    );

  const markAllReadFor = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: { organizationId: string }
  ) =>
    markAllReadEffect(args).pipe(
      Policy.withPolicy(markAllReadWrite[surface].policy(args)),
      withRemapDbErrors("Notification", "update"),
      withSurfaceRateLimit({
        level,
        operation: markAllReadWrite.operation,
        surface,
      })
    );

  // -- Surface-parameterized reads --
  //
  // Every query is scoped to the session user id, so results can never leak
  // another user's inbox; only the admission differs — a member on the
  // dashboard, a restricted widget session on the portal.

  const listRead = {
    operation: "NotificationList",
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
  } satisfies SurfacePair<TNotificationList, NotificationRpcTag>;

  const unreadCountRead = {
    operation: "NotificationUnreadCount",
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
  } satisfies SurfacePair<{ organizationId: string }, NotificationRpcTag>;

  const listFor = <Level extends RateLimit.PublicRpcRateLimitLevel | undefined>(
    surface: Surface,
    level: Level,
    args: TNotificationList
  ) =>
    listNotificationsEffect(args).pipe(
      Policy.withPolicy(listRead[surface].policy(args)),
      withRemapDbErrors("Notification", "select"),
      withSurfaceRateLimit({ level, operation: listRead.operation, surface })
    );

  const unreadCountFor = <
    Level extends RateLimit.PublicRpcRateLimitLevel | undefined,
  >(
    surface: Surface,
    level: Level,
    args: { organizationId: string }
  ) =>
    unreadCountEffect(args).pipe(
      Policy.withPolicy(unreadCountRead[surface].policy(args)),
      withRemapDbErrors("Notification", "select"),
      withSurfaceRateLimit({
        level,
        operation: unreadCountRead.operation,
        surface,
      })
    );

  return {
    NotificationList: (args: TNotificationList) =>
      listFor("dashboard", listRead.dashboard.rateLimit, args),
    NotificationUnreadCount: ({ organizationId }: { organizationId: string }) =>
      unreadCountFor("dashboard", unreadCountRead.dashboard.rateLimit, {
        organizationId,
      }),
    NotificationMarkRead: (args: TNotificationMarkRead) =>
      markReadFor("dashboard", markReadWrite.dashboard.rateLimit, args),
    NotificationMarkAllRead: ({ organizationId }: { organizationId: string }) =>
      markAllReadFor("dashboard", markAllReadWrite.dashboard.rateLimit, {
        organizationId,
      }),
    // Public-board variants for signed-in end users, who may not be workspace
    // members. Every query is scoped to the session user id, so results can
    // never leak another user's inbox.
    NotificationListPublic: (args: TNotificationList) =>
      listFor("public", listRead.public.rateLimit, args),
    NotificationUnreadCountPublic: ({
      organizationId,
    }: {
      organizationId: string;
    }) =>
      unreadCountFor("public", unreadCountRead.public.rateLimit, {
        organizationId,
      }),
    NotificationMarkReadPublic: (args: TNotificationMarkRead) =>
      markReadFor("public", markReadWrite.public.rateLimit, args),
    NotificationMarkAllReadPublic: ({
      organizationId,
    }: {
      organizationId: string;
    }) =>
      markAllReadFor("public", markAllReadWrite.public.rateLimit, {
        organizationId,
      }),
  };
});

export const NotificationRpcHandlers = NotificationRpcs.toLayer(
  NotificationRpcHandlersEffect
).pipe(
  Layer.provide(NotificationPolicy.layer),
  Layer.provide(NotificationService.layer)
);

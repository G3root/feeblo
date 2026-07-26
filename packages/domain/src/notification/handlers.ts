import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as Policy from "../policy";
import { withRemapDbErrors } from "../rpc-errors";
import { CurrentSession } from "../session-middleware";
import { NotificationPolicy } from "./policies";
import { NotificationRpcs } from "./rpcs";
import type { TNotificationList, TNotificationMarkRead } from "./schema";
import { NotificationService } from "./service";

export const NotificationRpcHandlersEffect = Effect.gen(function* () {
  const notifications = yield* NotificationService;
  const notificationPolicy = yield* NotificationPolicy;
  const currentMembership = (organizationId: string) =>
    Effect.gen(function* () {
      const session = yield* CurrentSession;
      const membership = Policy.getMembership(session, organizationId);
      if (!membership) {
        return yield* new Policy.PolicyDeniedError();
      }
      return membership;
    });

  return {
    NotificationList: (args: TNotificationList) =>
      Effect.gen(function* () {
        const membership = yield* currentMembership(args.organizationId);
        return yield* notifications.list({
          ...(args.cursor === undefined ? {} : { cursor: args.cursor }),
          ...(args.limit === undefined ? {} : { limit: args.limit }),
          organizationId: args.organizationId,
          recipientMemberId: membership.membershipId,
        });
      }).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(args.organizationId)),
        withRemapDbErrors("Notification", "select")
      ),
    NotificationUnreadCount: ({ organizationId }: { organizationId: string }) =>
      Effect.gen(function* () {
        const membership = yield* currentMembership(organizationId);
        const count = yield* notifications.unreadCount({
          organizationId,
          recipientMemberId: membership.membershipId,
        });
        return { count };
      }).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(organizationId)),
        withRemapDbErrors("Notification", "select")
      ),
    NotificationMarkRead: (args: TNotificationMarkRead) =>
      Effect.gen(function* () {
        const membership = yield* currentMembership(args.organizationId);
        yield* notifications.markRead({
          id: args.notificationId,
          organizationId: args.organizationId,
          recipientMemberId: membership.membershipId,
        });
      }).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(args.organizationId)),
        withRemapDbErrors("Notification", "update")
      ),
    NotificationMarkAllRead: ({ organizationId }: { organizationId: string }) =>
      Effect.gen(function* () {
        const membership = yield* currentMembership(organizationId);
        yield* notifications.markAllRead({
          organizationId,
          recipientMemberId: membership.membershipId,
        });
      }).pipe(
        Policy.withPolicy(notificationPolicy.canAccess(organizationId)),
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

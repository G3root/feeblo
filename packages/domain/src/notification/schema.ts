import { NotificationEventType } from "@feeblo/db/validation-schema/notification-kind";
import { NotificationId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Notification = S.Struct({
  id: S.String,
  organizationId: S.String,
  recipientMemberId: S.String,
  actorMemberId: S.NullOr(S.String),
  kind: NotificationEventType,
  resourceType: S.String,
  resourceId: S.String,
  title: S.String,
  body: S.NullOr(S.String),
  href: S.String,
  readAt: S.NullOr(S.DateFromString),
  createdAt: S.DateFromString,
});

export const NotificationList = S.Struct({
  organizationId: WorkspaceId.schema,
  cursor: S.optional(S.DateFromString),
  limit: S.optional(S.Number),
});

export const NotificationUnreadCount = S.Struct({
  organizationId: WorkspaceId.schema,
});

export const NotificationMarkRead = S.Struct({
  organizationId: WorkspaceId.schema,
  notificationId: NotificationId.schema,
});

export const NotificationMarkAllRead = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TNotificationList = S.Schema.Type<typeof NotificationList>;
export type TNotificationMarkRead = S.Schema.Type<typeof NotificationMarkRead>;

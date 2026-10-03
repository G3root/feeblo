import { NotificationEventType } from "@feeblo/db/validation-schema/notification-kind";
import { NotificationId, WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

export const Notification = S.Struct({
  id: S.String,
  organizationId: S.String,
  recipientUserId: S.String,
  actorUserId: S.NullOr(S.String),
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
  /**
   * Opaque page cursor: the sort key of the previous page's last row,
   * `(createdAt, id)`, base64url encoded. Composite on purpose — a fan-out
   * inserts every recipient row in one statement, so they all share one
   * `createdAt`, and a timestamp-only cursor would skip the batch remainder
   * past the page boundary. Decode failures are reported as invalid rather
   * than ignored, so a corrupt cursor cannot silently restart the list.
   */
  cursor: S.optional(S.String),
  limit: S.optional(S.Finite),
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

/** The sort key one page cursor carries: the last row's instant and id. */
const NotificationCursorPayload = S.Struct({
  createdAt: S.DateFromString,
  id: S.String,
});

/** Encodes the cursor for the next page of a notification list. */
export const encodeNotificationCursor = (cursor: {
  readonly createdAt: Date;
  readonly id: string;
}): string => Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

/**
 * Decodes the opaque cursor a client passed back, or `null` when there is
 * none. `undefined` for a cursor the request did not carry; an unreadable
 * value is the caller's mistake and is answered with `null` only after the
 * decode fails — the list then restarts, which the malformed value has asked
 * for by sending a cursor it did not get from this endpoint.
 */
export const decodeNotificationCursor = (
  cursor: string | undefined
): { readonly createdAt: Date; readonly id: string } | null => {
  if (cursor === undefined || cursor.length === 0) {
    return null;
  }
  try {
    return S.decodeSync(S.fromJsonString(NotificationCursorPayload))(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
  } catch {
    return null;
  }
};

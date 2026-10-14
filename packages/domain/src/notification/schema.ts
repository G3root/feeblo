import { NotificationEventType } from "@feeblo/db/validation-schema/notification-kind";
import { NotificationId, WorkspaceId } from "@feeblo/id";
import * as Option from "effect/Option";
import * as S from "effect/Schema";

export const Notification = S.Struct({
  id: S.String,
  organizationId: S.String,
  recipientUserId: S.String,
  actorUserId: S.NullOr(S.String),
  /**
   * The actor's display name and image, resolved at read time in `list`.
   * `null` for an event with no actor (a public submission has none) and for
   * an actor whose account was deleted (`actor_user_id` is `on delete set
   * null`), which is why the inbox falls back to the event kind's icon rather
   * than to initials.
   */
  actorName: S.NullOr(S.String),
  actorImage: S.NullOr(S.String),
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

export type TNotificationEventType = S.Schema.Type<
  typeof NotificationEventType
>;
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
 * Decodes the opaque cursor a client passed back.
 *
 * `Absent` for a cursor the request did not carry, so the list starts from the
 * newest row. Any other value that does not decode — including the empty
 * string — is `Invalid`: an unreadable cursor is the caller's mistake and is
 * answered with a request error, because treating it as absent would silently
 * restart the list and make a corrupted cursor look like a successful
 * continuation.
 */
export const decodeNotificationCursor = (
  cursor: string | undefined
):
  | { readonly _tag: "Absent" }
  | { readonly _tag: "Invalid" }
  | {
      readonly _tag: "Decoded";
      readonly createdAt: Date;
      readonly id: string;
    } => {
  if (cursor === undefined) {
    return { _tag: "Absent" };
  }
  const decoded = S.decodeOption(S.fromJsonString(NotificationCursorPayload))(
    Buffer.from(cursor, "base64url").toString("utf8")
  );
  return Option.isSome(decoded)
    ? {
        _tag: "Decoded",
        createdAt: decoded.value.createdAt,
        id: decoded.value.id,
      }
    : { _tag: "Invalid" };
};

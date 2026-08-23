import * as S from "effect/Schema";

/**
 * Canonical notification event-type vocabulary.
 *
 * The `notification.kind` column is plain text (not a Postgres enum) so new
 * event types don't require migrations; this Effect Schema is the single
 * source of truth. The column type is derived from it in `schema/feedback.ts`,
 * and `@feeblo/domain/notification/schema` builds its structs on it.
 */
export const NotificationEventType = S.Literals([
  "feedback.submitted",
  "feedback.commented",
  "feedback.status_changed",
]);

export type TNotificationEventType = S.Schema.Type<
  typeof NotificationEventType
>;

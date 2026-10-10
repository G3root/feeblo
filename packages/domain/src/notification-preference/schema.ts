import {
  NotificationPreferenceTarget,
  type TNotificationPreferenceChannel,
  type TNotificationPreferenceTarget,
} from "@feeblo/db/validation-schema/notification-preference";
import { WorkspaceId } from "@feeblo/id";
import * as S from "effect/Schema";

// The preference vocabulary is canonical in `@feeblo/domain-contracts`; the
// structs below embed it so the RPC shapes and their inferred types stay
// derived from the single source of truth.

/** The workspace whose preferences are read or written; the user is the session. */
export const NotificationPreferenceQuery = S.Struct({
  organizationId: WorkspaceId.schema,
});

export type TNotificationPreferenceQuery = S.Schema.Type<
  typeof NotificationPreferenceQuery
>;

/**
 * One write: a single category or the `all` pause, with the state the caller
 * wants committed. Disabling stores a row; enabling removes it, so the table
 * stays sparse and "no row" keeps one meaning.
 */
export const NotificationPreferenceSetRequest = S.Struct({
  organizationId: WorkspaceId.schema,
  target: NotificationPreferenceTarget,
  enabled: S.Boolean,
});

export type TNotificationPreferenceSetRequest = S.Schema.Type<
  typeof NotificationPreferenceSetRequest
>;

export const NotificationPreferenceCategoryState = S.Struct({
  new_feedback: S.Boolean,
  post_status_changed: S.Boolean,
  changelog_published: S.Boolean,
});

export type TNotificationPreferenceCategoryState = S.Schema.Type<
  typeof NotificationPreferenceCategoryState
>;

/**
 * The resolved state, defaults already applied: `pausedAll` and every
 * category are `true` unless a row disables them. Both the read and the write
 * answer with this shape, so a caller can render a committed toggle from the
 * mutation response alone.
 */
export const NotificationPreferenceState = S.Struct({
  pausedAll: S.Boolean,
  categories: NotificationPreferenceCategoryState,
});

export type TNotificationPreferenceState = S.Schema.Type<
  typeof NotificationPreferenceState
>;

/** One stored row, as the reader needs it. */
export type StoredNotificationPreference = {
  readonly category: TNotificationPreferenceTarget;
  readonly enabled: boolean;
};

/**
 * Applies the sparse rows over the on-by-default state. A row is meaningful
 * only when it disables something: the `all` target flips `pausedAll`, a
 * category target flips its own key, and everything unmentioned stays on.
 */
export const resolveNotificationPreferenceState = (
  rows: readonly StoredNotificationPreference[]
): TNotificationPreferenceState => {
  const disabled = new Set(
    rows.filter((row) => !row.enabled).map((row) => row.category)
  );
  return {
    pausedAll: disabled.has("all"),
    categories: {
      new_feedback: !disabled.has("new_feedback"),
      post_status_changed: !disabled.has("post_status_changed"),
      changelog_published: !disabled.has("changelog_published"),
    },
  };
};

/**
 * The `email` channel every preference row is written under until the in-app
 * phase adds a second one.
 */
export const emailPreferenceChannel: TNotificationPreferenceChannel = "email";

/** Opaque token supplied by a member one-click unsubscribe link. */
export const NotificationPreferenceUnsubscribeTokenRequest = S.Struct({
  token: S.String.pipe(S.check(S.isMinLength(1)), S.check(S.isMaxLength(512))),
});

export type TNotificationPreferenceUnsubscribeTokenRequest = S.Schema.Type<
  typeof NotificationPreferenceUnsubscribeTokenRequest
>;

/** Deliberately token-free public acknowledgement for a one-click unsubscribe. */
export const NotificationPreferenceUnsubscribeAccepted = S.Struct({
  unsubscribed: S.Boolean,
});

/**
 * The GET link's answer: the token is valid, and the state-changing write
 * belongs to the POST. Link scanners and mail clients prefetch GET URLs, so a
 * valid GET must never unsubscribe on its own.
 */
export const NotificationPreferenceUnsubscribeLinkAccepted = S.Struct({
  valid: S.Boolean,
});

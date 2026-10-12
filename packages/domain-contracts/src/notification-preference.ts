import * as S from "effect/Schema";

/**
 * Canonical notification-preference vocabulary, shared by the browser and the
 * server (see `docs/adr/0002`).
 *
 * Preferences are per `(workspace, user)` and default **on**: a stored row is a
 * divergence from the default, not an opt-in. `email` is the only channel a
 * preference can be written for today; `in_app` is reserved for the phase that
 * gives the same categories an in-app toggle, which is why the channel is part
 * of the key rather than implied.
 *
 * Categories name the product event, not the transport or the template:
 * `new_feedback` is a new post submission, `post_status_changed` covers every
 * status transition including merge, unmerge, and close, and
 * `changelog_published` is an entry going live. A category is disabled by
 * storing `enabled: false`; the master pause is the same mechanism with the
 * `all` target.
 */
export const NotificationPreferenceChannel = S.Literals(["email"]);

export type TNotificationPreferenceChannel = S.Schema.Type<
  typeof NotificationPreferenceChannel
>;

export const notificationPreferenceCategories = [
  "new_feedback",
  "post_status_changed",
  "changelog_published",
] as const;

export const NotificationPreferenceCategory = S.Literals(
  notificationPreferenceCategories
);

export type TNotificationPreferenceCategory = S.Schema.Type<
  typeof NotificationPreferenceCategory
>;

/**
 * One stored row's target: a single category, or `all` for the workspace-wide
 * pause that suppresses every notification mail to the user in that
 * workspace.
 */
export const NotificationPreferenceTarget = S.Literals([
  "all",
  ...notificationPreferenceCategories,
]);

export type TNotificationPreferenceTarget = S.Schema.Type<
  typeof NotificationPreferenceTarget
>;

import * as Duration from "effect/Duration";

export type {
  PostStatusChangedChange,
  PostStatusChangedEmailPayload,
} from "@feeblo/db/validation-schema/email-event-payload";

/** "IN_PROGRESS" → "In progress" (mirrors the dashboard's activity labels). */
export const formatStatusLabel = (type: string): string => {
  const lower = type.replaceAll("_", " ").toLowerCase();
  const first = lower.charAt(0).toUpperCase();
  return lower.length === 0 ? lower : `${first}${lower.slice(1)}`;
};

/** Public post URL, mirroring the submission-notification workflow. */
export const postUrl = (
  organizationId: string,
  boardSlug: string,
  slug: string
): string =>
  `https://app.feeblo.com/${organizationId}/post/${boardSlug}/${slug}`;

/**
 * Coalescing window bucket. All status changes for the same post inside one
 * window share a dedupe key and collapse onto a single email event.
 */
export const digestWindowKey = (
  postId: string,
  now: Date,
  window: Duration.Duration
): string => {
  const windowMillis = Duration.toMillis(window);
  const bucket = Math.floor(now.getTime() / windowMillis);
  return `post_status_changed:${postId}:${bucket}`;
};

export type EmailEventEnqueueResult = {
  /** The event row that will deliver this notification (new or merged). */
  readonly eventId: string;
  /** True when a fresh event row was inserted (a workflow must be scheduled). */
  readonly inserted: boolean;
};

/**
 * Self-contained payload for transactional email events (shared vocabulary).
 *
 * These types are plain TypeScript (no Effect Schema) because they cross the
 * package boundary between `@feeblo/db` (storage) and `@feeblo/domain`
 * (enqueue/dispatch). The payload is written once, inside the source
 * mutation's transaction, and must contain everything needed to render the
 * email later — later edits or deletes of the post/status cannot corrupt
 * delivery. Recipients are intentionally NOT stored: they are resolved fresh
 * at send time so unsubscribes take effect immediately.
 */

/** One status change leg. Multiple legs coalesce into one email (digest). */
export type PostStatusChangedChange = {
  readonly previousStatusType: string;
  readonly previousStatusLabel: string;
  readonly nextStatusType: string;
  readonly nextStatusLabel: string;
};

export type PostStatusChangedEmailPayload = {
  readonly kind: "post_status_changed";
  readonly organizationId: string;
  readonly postId: string;
  /** Snapshot of the post title at enqueue time. */
  readonly postTitle: string;
  /** Snapshot of the public post URL at enqueue time. */
  readonly postUrl: string;
  /** The member who changed the status (excluded from recipients). */
  readonly actorMemberId: string | null;
  /** The user who changed the status (excluded from recipients). */
  readonly actorUserId: string | null;
  readonly changes: readonly PostStatusChangedChange[];
};

export type EmailEventPayload = PostStatusChangedEmailPayload;

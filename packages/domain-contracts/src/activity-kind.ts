import * as S from "effect/Schema";

/**
 * Canonical post-activity kind vocabulary.
 *
 * The `post_activity.kind` column is plain text (not a Postgres enum) so new
 * kinds don't require migrations; this Effect Schema is the single source of
 * truth. The column type is derived from it in `schema/feedback.ts`
 * (`$type<TPostActivityKind>()`), and `@feeblo/domain/post-activity/schema`
 * builds its structs on it.
 */
export const PostActivityKind = S.Literals([
  "POST_CREATED",
  "TITLE_CHANGED",
  "CONTENT_CHANGED",
  "STATUS_CHANGED",
  "BOARD_CHANGED",
  "ETA_CHANGED",
  "POST_LOCKED",
  "POST_UNLOCKED",
  "POST_ARCHIVED",
  "POST_UNARCHIVED",
  "TAG_ADDED",
  "TAG_REMOVED",
  "OFFICIAL_UPDATE_PUBLISHED",
  "COMMENT_CREATED",
  "COMMENT_UPDATED",
  "COMMENT_DELETED",
  // On-behalf voter management (see plan-on-behalf.md). The actor is the
  // staff member; the subject is recorded in `post_activity.metadata`.
  "VOTE_ADDED",
  "VOTE_REMOVED",
  "COMMENT_PINNED",
  "COMMENT_UNPINNED",
]);

export type TPostActivityKind = S.Schema.Type<typeof PostActivityKind>;

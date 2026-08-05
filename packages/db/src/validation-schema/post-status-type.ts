import * as S from "effect/Schema";

/**
 * Canonical post-status type vocabulary.
 *
 * The `post_status.type` column is plain text (not a Postgres enum) so new
 * status types don't require migrations; this Effect Schema is the single
 * source of truth. The db schema re-exports `TPostStatus` / `POST_STATUS_TYPES`
 * derived from it for backward compatibility.
 */
export const PostStatusType = S.Literals([
  "PENDING",
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
]);

export type TPostStatusType = S.Schema.Type<typeof PostStatusType>;

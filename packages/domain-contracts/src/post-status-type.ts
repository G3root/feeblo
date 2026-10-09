import * as S from "effect/Schema";

/**
 * Canonical post-status type vocabulary, in display order.
 *
 * The `post_status.type` column is plain text (not a Postgres enum) so new
 * status types don't require migrations; this list is the single source of
 * truth. The order here is the section order on the statuses settings page and
 * the lane order on the board, so it is meaningful rather than incidental —
 * a type added here appears in both places at the position it is listed.
 *
 * The db schema re-exports `TPostStatus` / `POST_STATUS_TYPES` derived from it
 * for backward compatibility.
 */
export const POST_STATUS_TYPES = [
  "PENDING",
  "REVIEW",
  "PLANNED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
] as const;

export type TPostStatusType = (typeof POST_STATUS_TYPES)[number];

export const PostStatusType = S.Literals(POST_STATUS_TYPES);

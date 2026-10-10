import {
  POST_STATUS_TYPES,
  type TPostStatusType,
} from "@feeblo/domain/post-status/schema";

/**
 * Section headings for the statuses settings page.
 *
 * The section a status belongs to is its `type`, which is also what the board
 * uses to pick a lane icon and what the workspace's webhook payloads carry. The
 * heading is copy rather than data: "Reviewing" reads as a place a status
 * lives, while the stored type `REVIEW` reads as a machine value.
 */
const POST_STATUS_SECTION_LABELS = {
  CLOSED: "Canceled",
  COMPLETED: "Completed",
  IN_PROGRESS: "Active",
  PENDING: "Pending",
  PLANNED: "Planned",
  REVIEW: "Reviewing",
} satisfies Record<TPostStatusType, string>;

export type PostStatusSection = {
  label: string;
  type: TPostStatusType;
};

/**
 * The sections in display order, taken from the vocabulary's own order so a
 * type added there appears here — and on the board, which the server sorts by
 * the same list — at the position it is listed.
 */
export const postStatusSections: readonly PostStatusSection[] =
  POST_STATUS_TYPES.map((type) => ({
    label: POST_STATUS_SECTION_LABELS[type],
    type,
  }));

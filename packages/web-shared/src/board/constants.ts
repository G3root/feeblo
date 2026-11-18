import type { TPostStatusType } from "@feeblo/domain/post-status/schema";

export type BoardPostStatus = TPostStatusType;

/**
 * The colour a status lane paints its mark with.
 *
 * The mark itself is a Tabler name stored on the status; this map is only the
 * lane's colour, which a workspace does not customise on the board surface.
 * A status with no colour still reads as a status because the mark is the
 * picker's, not this map's.
 */
export const BOARD_LANE_COLOR_MAP = {
  // Muted, dark-safe hues model the low-saturation status language of Linear.
  PENDING: "text-neutral-500 dark:text-neutral-400",
  REVIEW: "text-amber-600 dark:text-amber-400",
  PLANNED: "text-indigo-600 dark:text-indigo-400",
  IN_PROGRESS: "text-yellow-600 dark:text-yellow-400",
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  CLOSED: "text-red-600 dark:text-red-400",
} satisfies Record<BoardPostStatus, string>;

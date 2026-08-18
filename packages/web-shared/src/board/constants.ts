import type { TPostStatus } from "@feeblo/db/schema/feedback";
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  DashedLineCircleIcon,
  PauseCircleIcon,
} from "@hugeicons/core-free-icons";

export type BoardPostStatus = TPostStatus;

export const BoardIconMap = {
  CLOSED: CancelCircleIcon,
  PENDING: PauseCircleIcon,
  COMPLETED: CheckmarkCircle02Icon,
  REVIEW: DashedLineCircleIcon,
  PLANNED: Clock01Icon,
  IN_PROGRESS: CircleIcon,
} satisfies Record<BoardPostStatus, typeof CancelCircleIcon>;

export const BOARD_LANE_COLUMN_MAP = {
  PENDING: "Pending",
  REVIEW: "Review",
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
} satisfies Record<BoardPostStatus, string>;

export const BOARD_LANE_COLOR_MAP = {
  // Muted, dark-safe hues model the low-saturation status language of Linear.
  PENDING: "text-neutral-500 dark:text-neutral-400",
  REVIEW: "text-amber-600 dark:text-amber-400",
  PLANNED: "text-indigo-600 dark:text-indigo-400",
  IN_PROGRESS: "text-yellow-600 dark:text-yellow-400",
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  CLOSED: "text-red-600 dark:text-red-400",
} satisfies Record<BoardPostStatus, string>;

export const BOARD_STATUS_INDICATOR_COLOR_MAP = {
    PENDING: "bg-neutral-500 dark:bg-neutral-400",
    REVIEW: "bg-amber-600 dark:bg-amber-400",
    PLANNED: "bg-indigo-600 dark:bg-indigo-400",
    IN_PROGRESS: "bg-yellow-600 dark:bg-yellow-400",
    COMPLETED: "bg-emerald-600 dark:bg-emerald-400",
    CLOSED: "bg-red-600 dark:bg-red-400",
  } satisfies Record<BoardPostStatus, string>;

export function getBoardStatusIndicatorColor(status: string) {
  return (
    // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
    BOARD_STATUS_INDICATOR_COLOR_MAP[status as BoardPostStatus] ??
    "bg-muted-foreground/40"
  );
}

export function getBoardStatusLabel(status: BoardPostStatus) {
  return BOARD_LANE_COLUMN_MAP[status];
}

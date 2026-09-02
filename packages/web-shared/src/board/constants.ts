import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import {
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  CircleIcon,
  Clock01Icon,
  DashedLineCircleIcon,
  PauseCircleIcon,
} from "@hugeicons/core-free-icons";

export type BoardPostStatus = TPostStatusType;

export const BoardIconMap = {
  CLOSED: CancelCircleIcon,
  PENDING: PauseCircleIcon,
  COMPLETED: CheckmarkCircle02Icon,
  REVIEW: DashedLineCircleIcon,
  PLANNED: Clock01Icon,
  IN_PROGRESS: CircleIcon,
} satisfies Record<BoardPostStatus, typeof CancelCircleIcon>;

export const BOARD_LANE_COLOR_MAP = {
  // Muted, dark-safe hues model the low-saturation status language of Linear.
  PENDING: "text-neutral-500 dark:text-neutral-400",
  REVIEW: "text-amber-600 dark:text-amber-400",
  PLANNED: "text-indigo-600 dark:text-indigo-400",
  IN_PROGRESS: "text-yellow-600 dark:text-yellow-400",
  COMPLETED: "text-emerald-600 dark:text-emerald-400",
  CLOSED: "text-red-600 dark:text-red-400",
} satisfies Record<BoardPostStatus, string>;

/**
 * Fallback display label derived from the status type, used only when a
 * status row's `label` is empty (e.g. pre-migration rows).
 */
export function formatPostStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

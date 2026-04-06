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

export const BoardIconMap: Record<BoardPostStatus, typeof CancelCircleIcon> = {
  CLOSED: CancelCircleIcon,
  PENDING: PauseCircleIcon,
  COMPLETED: CheckmarkCircle02Icon,
  REVIEW: DashedLineCircleIcon,
  PLANNED: Clock01Icon,
  IN_PROGRESS: CircleIcon,
};

export const BOARD_LANE_COLUMN_MAP: Record<BoardPostStatus, string> = {
  PENDING: "Pending",
  REVIEW: "Review",
  PLANNED: "Planned",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
};

export const BOARD_LANE_COLOR_MAP: Record<BoardPostStatus, string> = {
  PENDING: "text-primary-blue",
  REVIEW: "text-muted-foreground",
  PLANNED: "text-muted-foreground",
  IN_PROGRESS: "text-primary-yellow",
  COMPLETED: "text-chart-2",
  CLOSED: "text-destructive",
};

export function getBoardStatusLabel(status: BoardPostStatus) {
  return BOARD_LANE_COLUMN_MAP[status];
}

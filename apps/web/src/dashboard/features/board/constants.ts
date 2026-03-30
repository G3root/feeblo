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

export const IconMap: Record<BoardPostStatus, typeof CancelCircleIcon> = {
  CLOSED: CancelCircleIcon,
  PAUSED: PauseCircleIcon,
  COMPLETED: CheckmarkCircle02Icon,
  REVIEW: DashedLineCircleIcon,
  PLANNED: Clock01Icon,
  IN_PROGRESS: CircleIcon,
};

export const BOARD_LANE_COLUMN_MAP: Record<BoardPostStatus, string> = {
  PAUSED: "paused",
  REVIEW: "review",
  PLANNED: "todo",
  IN_PROGRESS: "in-progress",
  COMPLETED: "completed",
  CLOSED: "canceled",
};

export const BOARD_LANE_COLOR_MAP: Record<BoardPostStatus, string> = {
  PAUSED: "text-primary-blue",
  REVIEW: "text-muted-foreground",
  PLANNED: "text-muted-foreground",
  IN_PROGRESS: "text-primary-yellow",
  COMPLETED: "text-chart-2",
  CLOSED: "text-destructive",
};

export const BOARD_LANE_COLUMNS = Object.keys(BOARD_LANE_COLUMN_MAP);

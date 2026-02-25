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

export type BoardLaneConfig = {
  key: string;
  label: string;
  statuses: BoardPostStatus[];
  toneVar: string;
};

export const BOARD_LANES: BoardLaneConfig[] = [
  {
    key: "in-progress",
    label: "In Progress",
    statuses: ["IN_PROGRESS"],
    toneVar: "var(--chart-1)",
  },
  {
    key: "review",
    label: "Technical Review",
    statuses: ["REVIEW"],
    toneVar: "var(--chart-2)",
  },
  {
    key: "completed",
    label: "Completed",
    statuses: ["COMPLETED"],
    toneVar: "var(--chart-3)",
  },
  {
    key: "paused",
    label: "Paused",
    statuses: ["PAUSED"],
    toneVar: "var(--chart-4)",
  },
  {
    key: "todo",
    label: "Todo",
    statuses: ["PLANNED"],
    toneVar: "var(--muted-foreground)",
  },
  {
    key: "canceled",
    label: "Canceled",
    statuses: ["CLOSED"],
    toneVar: "var(--destructive)",
  },
];

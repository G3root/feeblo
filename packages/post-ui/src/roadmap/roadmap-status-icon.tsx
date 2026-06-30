import { cn } from "@feeblo/ui/utils";
import {
  BOARD_LANE_COLOR_MAP,
  BoardIconMap,
} from "@feeblo/web-shared/board/constants";
import { HugeiconsIcon } from "@hugeicons/react";
import type { RoadmapStatus } from "./types";

export function RoadmapStatusIcon({ status }: { status: RoadmapStatus }) {
  const Icon = BoardIconMap[status] ?? BoardIconMap.PLANNED;
  const color = BOARD_LANE_COLOR_MAP[status];

  return (
    <span className={cn("inline-flex items-center justify-center", color)}>
      <HugeiconsIcon className="size-4" icon={Icon} strokeWidth={2.5} />
    </span>
  );
}

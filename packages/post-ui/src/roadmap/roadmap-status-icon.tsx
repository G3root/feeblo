import { cn } from "@feeblo/ui/utils";
import { BOARD_LANE_COLOR_MAP } from "@feeblo/web-shared/board/constants";

import { PostStatusIcon } from "../post-status-icon";
import type { RoadmapStatus } from "./types";

export function RoadmapStatusIcon({
  icon,
  status,
}: {
  icon?: string | null;
  status: RoadmapStatus;
}) {
  const color = BOARD_LANE_COLOR_MAP[status];

  return (
    <span className={cn("inline-flex items-center justify-center", color)}>
      <PostStatusIcon icon={icon} type={status} />
    </span>
  );
}

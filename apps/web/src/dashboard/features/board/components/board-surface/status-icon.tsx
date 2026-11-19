import { PostStatusIcon } from "@feeblo/post-ui/post-status-icon";
import { cn } from "@feeblo/ui/utils";
import {
  BOARD_LANE_COLOR_MAP,
  type BoardPostStatus,
} from "@feeblo/web-shared/board/constants";

export function StatusIcon({
  icon,
  status,
}: {
  icon?: string | null;
  status: BoardPostStatus;
}) {
  const color = BOARD_LANE_COLOR_MAP[status];

  return (
    <span className={cn("inline-flex items-center justify-center", color)}>
      <PostStatusIcon icon={icon} type={status} />
    </span>
  );
}

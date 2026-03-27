import { HugeiconsIcon } from "@hugeicons/react";
import { cn } from "~/lib/utils";
import {
  BOARD_LANE_COLOR_MAP,
  type BoardPostStatus,
  IconMap,
} from "../../constants";

export function StatusIcon({ status }: { status: BoardPostStatus }) {
  const Icon = IconMap[status];
  const color = BOARD_LANE_COLOR_MAP[status];

  return (
    <span className={cn("inline-flex items-center justify-center", color)}>
      <HugeiconsIcon className="size-4" icon={Icon} strokeWidth={2.5} />
    </span>
  );
}

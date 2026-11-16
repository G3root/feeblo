import type { TBoardGroupBy } from "@feeblo/domain-contracts/board-query";
import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import {
  DashboardSquare01Icon,
  GroupItemsIcon,
  Rows3Icon,
  Tag01Icon,
  UserCircleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { StatusIcon } from "./status-icon";

/**
 * The neutral lane mark per grouping. `status` is the fallback for a lane that
 * groups by status without a status to show, which renders as a generic list.
 */
const LANE_ICON_BY_GROUPING: Record<TBoardGroupBy, typeof GroupItemsIcon> = {
  assignee: UserCircleIcon,
  board: DashboardSquare01Icon,
  label: Tag01Icon,
  none: Rows3Icon,
  status: GroupItemsIcon,
};

/**
 * The mark on a lane header, chosen by what the lane represents.
 *
 * Status lanes keep the status icon and colour, because those are the same
 * marks the post rows and the filter menu use. The other groupings get a
 * neutral icon: a lane is not a status, and painting "Assigned to Alice" with
 * a status colour would say it is.
 */
export function BoardLaneIcon({
  groupBy,
  status,
}: {
  groupBy: TBoardGroupBy;
  status?: BoardPostStatus;
}) {
  if (groupBy === "status" && status) {
    return <StatusIcon status={status} />;
  }

  const icon = LANE_ICON_BY_GROUPING[groupBy];

  return (
    <HugeiconsIcon
      className="text-muted-foreground size-4"
      icon={icon}
      strokeWidth={2}
    />
  );
}

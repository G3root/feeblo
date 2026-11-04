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

  const icon =
    groupBy === "assignee"
      ? UserCircleIcon
      : groupBy === "board"
        ? DashboardSquare01Icon
        : groupBy === "label"
          ? Tag01Icon
          : groupBy === "none"
            ? Rows3Icon
            : GroupItemsIcon;

  return (
    <HugeiconsIcon
      className="text-muted-foreground size-4"
      icon={icon}
      strokeWidth={2}
    />
  );
}

import { CollisionPriority } from "@dnd-kit/abstract";
import { useSortable } from "@dnd-kit/react/sortable";
import type { TBoardGroupBy } from "@feeblo/domain-contracts/board-query";
import { formatPostStatus } from "@feeblo/post-ui/post-status";
import { RoadmapLaneColumn } from "@feeblo/post-ui/roadmap/roadmap-lane-column";
import { Button } from "@feeblo/ui/button";
import { type BoardPostStatus } from "@feeblo/web-shared/board/constants";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";

import { usePostCreateDialogContext } from "~/features/post/dialog-stores";

import { BoardLaneIcon } from "./board-lane-icon";

interface BoardGridLaneColumnProps {
  boardId?: string;
  children?: React.ReactNode;
  groupBy: TBoardGroupBy;
  id: string;
  index: number;
  label: string;
  /** Present only for a status lane. */
  status?: BoardPostStatus;
  statusId?: string;
  totalPosts: number;
}

const BoardGridLaneColumn = memo(function BoardGridLaneColumn({
  id,
  index,
  children,
  totalPosts,
  status,
  statusId,
  boardId,
  groupBy,
  label,
}: BoardGridLaneColumnProps) {
  const store = usePostCreateDialogContext();
  const effectiveLabel = label || (status ? formatPostStatus(status) : "Posts");
  const { ref, isDropTarget } = useSortable({
    id,
    accept: "item",
    collisionPriority: CollisionPriority.Low,
    type: "column",
    index,
    data: { column: status, statusId },
  });

  return (
    <RoadmapLaneColumn
      action={
        status !== undefined && statusId !== undefined ? (
          <Button
            aria-label={`Add post to ${effectiveLabel}`}
            onClick={() => {
              store.send({
                type: "toggle",
                data: {
                  boardId,
                  source: "board_column",
                  status,
                  statusId,
                },
              });
            }}
            size="icon-xs"
            variant="ghost"
          >
            <HugeiconsIcon icon={PlusSignIcon} />
          </Button>
        ) : undefined
      }
      contentRef={ref}
      icon={<BoardLaneIcon groupBy={groupBy} status={status} />}
      isHighlighted={isDropTarget}
      label={effectiveLabel}
      status={status}
      totalPosts={totalPosts}
    >
      {children}
    </RoadmapLaneColumn>
  );
});

export { BoardGridLaneColumn };

import { CollisionPriority } from "@dnd-kit/abstract";
import { useSortable } from "@dnd-kit/react/sortable";
import { RoadmapLaneColumn } from "@feeblo/post-ui/roadmap/roadmap-lane-column";
import { Button } from "@feeblo/ui/button";
import {
  formatPostStatus,
  type BoardPostStatus,
} from "@feeblo/web-shared/board/constants";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";

import { usePostCreateDialogContext } from "~/features/post/dialog-stores";

interface BoardGridLaneColumnProps {
  boardId?: string;
  children?: React.ReactNode;
  id: string;
  index: number;
  label: string;
  status: BoardPostStatus;
  statusId: string;
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
  label,
}: BoardGridLaneColumnProps) {
  const store = usePostCreateDialogContext();
  const effectiveLabel = label || formatPostStatus(status);
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
      }
      contentRef={ref}
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

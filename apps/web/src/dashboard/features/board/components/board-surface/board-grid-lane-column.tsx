import { CollisionPriority } from "@dnd-kit/abstract";
import { useSortable } from "@dnd-kit/react/sortable";
import { Button } from "@feeblo/ui/button";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { RoadmapLaneColumn } from "~/features/roadmap/components";
import { type BoardPostStatus, getBoardStatusLabel } from "../../constants";

interface BoardGridLaneColumnProps {
  boardId?: string;
  children?: React.ReactNode;
  id: string;
  index: number;
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
}: BoardGridLaneColumnProps) {
  const store = usePostCreateDialogContext();
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
          aria-label={`Add post to ${getBoardStatusLabel(status)}`}
          onClick={() => {
            store.send({
              type: "toggle",
              data: { boardId, status, statusId },
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
      status={status}
      totalPosts={totalPosts}
    >
      {children}
    </RoadmapLaneColumn>
  );
});

export { BoardGridLaneColumn };

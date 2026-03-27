import { CollisionPriority } from "@dnd-kit/abstract";
import { useSortable } from "@dnd-kit/react/sortable";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { memo } from "react";
import { Button } from "~/components/ui/button";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { cn } from "~/lib/utils";
import { BOARD_LANE_COLUMN_MAP, type BoardPostStatus } from "../../constants";
import { StatusIcon } from "./status-icon";

interface BoardGridLaneColumnProps {
  boardId: string;
  children?: React.ReactNode;
  id: string;
  index: number;
  status: BoardPostStatus;
  totalPosts: number;
}

const BoardGridLaneColumn = memo(function BoardGridLaneColumn({
  id,
  index,
  children,
  totalPosts,
  status,
  boardId,
}: BoardGridLaneColumnProps) {
  const store = usePostCreateDialogContext();
  const { ref, isDropTarget } = useSortable({
    id,
    accept: "item",
    collisionPriority: CollisionPriority.Low,
    type: "column",
    index,
  });

  const readableStatus = BOARD_LANE_COLUMN_MAP[status];

  return (
    <div className="flex h-96 w-80 flex-col overflow-hidden rounded-lg bg-muted/30">
      <div className="px-3 py-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <StatusIcon status={status} />
            <h3 className="font-medium text-sm">{readableStatus}</h3>
            <span className="text-muted-foreground text-xs">{totalPosts}</span>
          </div>

          <Button
            aria-label={`Add post to ${readableStatus}`}
            onClick={() => {
              store.send({
                type: "toggle",
                data: { boardId, status },
              });
            }}
            size="icon-xs"
            variant="ghost"
          >
            <HugeiconsIcon icon={PlusSignIcon} />
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "flex-1 space-y-2 overflow-y-auto p-3 transition-colors",
          isDropTarget && "bg-muted/50"
        )}
        ref={ref}
      >
        {children}
      </div>
    </div>
  );
});

export { BoardGridLaneColumn };

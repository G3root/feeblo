import { CollisionPriority } from "@dnd-kit/abstract";
import { KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { SortableRoadmapIssueCard } from "@feeblo/post-ui/roadmap/roadmap-issue-card";
import { RoadmapLaneColumn } from "@feeblo/post-ui/roadmap/roadmap-lane-column";
import type { RoadmapLane, RoadmapPost } from "@feeblo/post-ui/roadmap/types";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { getBoardStatusLabel } from "@feeblo/web-shared/board/constants";
import { PlusSignIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useRef, useState } from "react";
import { usePostCreateDialogContext } from "~/features/post/dialog-stores";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

const sensors = [
  PointerSensor.configure({
    activatorElements(source) {
      return [source.element, source.handle];
    },
  }),
  KeyboardSensor,
];

export type RoadmapBoardPost = RoadmapPost & {
  boardName: string;
  boardSlug: string;
};

type RoadmapBoardProps = {
  lanes: RoadmapLane<RoadmapBoardPost>[];
  organizationId: string;
};

export function RoadmapBoard({ lanes, organizationId }: RoadmapBoardProps) {
  const { postCollection } = useDashboardCollections();
  const [dragPreview, setDragPreview] = useState<
    RoadmapLane<RoadmapBoardPost>[] | null
  >(null);
  const items = dragPreview ?? lanes;
  const activeDrag = useRef<{
    sourceId: string;
    sourceStatusId: string;
    targetStatusId: string | null;
  } | null>(null);

  const handleDragStart = useCallback<DragDropEventHandlers["onDragStart"]>(
    (event) => {
      const { source } = event.operation;

      if (source?.type !== "item") {
        activeDrag.current = null;
        return;
      }

      activeDrag.current = {
        sourceId: source.id as string,
        sourceStatusId: source.data?.statusId as string,
        targetStatusId: null,
      };
    },
    []
  );

  const handleDragOver = useCallback<DragDropEventHandlers["onDragOver"]>(
    (event) => {
      const { source, target } = event.operation;

      if (source?.type !== "item") {
        return;
      }

      const targetStatusId = target?.data?.statusId as string | undefined;
      if (!targetStatusId) {
        return;
      }

      if (activeDrag.current) {
        activeDrag.current.targetStatusId = targetStatusId;
      }

      setDragPreview((currentItems) =>
        movePostToStatus(
          currentItems ?? lanes,
          source.id as string,
          targetStatusId
        )
      );
    },
    [lanes]
  );

  const handleDragEnd = useCallback<DragDropEventHandlers["onDragEnd"]>(
    (event) => {
      const { source, target } = event.operation;
      const dragState = activeDrag.current;
      activeDrag.current = null;

      if (event.canceled || source?.type !== "item") {
        setDragPreview(null);
        return;
      }

      const sourceStatusId =
        dragState?.sourceStatusId ??
        (source.data?.statusId as string | undefined);
      const targetStatusId =
        dragState?.targetStatusId ??
        (target?.data?.statusId as string | undefined);

      if (
        !(sourceStatusId && targetStatusId) ||
        sourceStatusId === targetStatusId
      ) {
        setDragPreview(null);
        return;
      }

      const tx = postCollection.update(
        dragState?.sourceId ?? (source.id as string),
        (draft) => {
          draft.statusId = targetStatusId;
        }
      );
      setDragPreview(null);

      void tx.isPersisted.promise.then(
        () => trackEvent("post_updated", { field: "status", success: true }),
        () => {
          trackEvent("post_updated", { field: "status", success: false });
          toastManager.add({ title: "Failed to update status", type: "error" });
        }
      );
    },
    [postCollection]
  );

  return (
    <DragDropProvider
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <div className="min-h-0 flex-1 overflow-x-auto overflow-y-hidden p-3 pb-[max(calc(var(--spacing)*3),env(safe-area-inset-bottom))]">
        <div className="grid h-full min-h-0 min-w-max auto-cols-max grid-flow-col gap-4">
          {items.map((lane, index) => (
            <RoadmapBoardLane
              index={index}
              key={lane.statusId}
              lane={lane}
              organizationId={organizationId}
            />
          ))}
        </div>
      </div>
    </DragDropProvider>
  );
}

function movePostToStatus(
  lanes: RoadmapLane<RoadmapBoardPost>[],
  postId: string,
  targetStatusId: string
) {
  const nextLanes = structuredClone(lanes);
  const sourceLane = nextLanes.find((lane) =>
    lane.posts.some((post) => post.id === postId)
  );
  const targetLane = nextLanes.find((lane) => lane.statusId === targetStatusId);

  if (!(sourceLane && targetLane) || sourceLane === targetLane) {
    return lanes;
  }

  const postIndex = sourceLane.posts.findIndex((post) => post.id === postId);
  if (postIndex === -1) {
    return lanes;
  }

  const [post] = sourceLane.posts.splice(postIndex, 1);
  if (!post) {
    return lanes;
  }

  post.status = targetLane.status;
  post.statusId = targetLane.statusId;
  targetLane.posts.push(post);
  return nextLanes;
}

const RoadmapBoardLane = memo(function RoadmapBoardLane({
  index,
  lane,
  organizationId,
}: {
  index: number;
  lane: RoadmapLane<RoadmapBoardPost>;
  organizationId: string;
}) {
  const createPostStore = usePostCreateDialogContext();
  const { ref, isDropTarget } = useSortable({
    id: lane.statusId,
    accept: "item",
    collisionPriority: CollisionPriority.Low,
    type: "column",
    index,
    data: { statusId: lane.statusId },
  });

  return (
    <RoadmapLaneColumn
      action={
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs tabular-nums">
            {lane.posts.length}
          </span>
          <Button
            aria-label={`Add post to ${lane.name ?? getBoardStatusLabel(lane.status)}`}
            onClick={() => {
              createPostStore.send({
                type: "toggle",
                data: {
                  source: "roadmap",
                  status: lane.status,
                  statusId: lane.statusId,
                },
              });
            }}
            size="icon-xs"
            variant="ghost"
          >
            <HugeiconsIcon icon={PlusSignIcon} />
          </Button>
        </div>
      }
      contentRef={ref}
      isHighlighted={isDropTarget}
      name={lane.name}
      status={lane.status}
    >
      {lane.posts.length > 0 ? (
        lane.posts.map((post, postIndex) => (
          <RoadmapBoardCard
            index={postIndex}
            key={post.id}
            organizationId={organizationId}
            post={post}
          />
        ))
      ) : (
        <div className="rounded-md border border-border/70 border-dashed bg-background/40 px-3 py-6 text-center text-muted-foreground text-sm">
          No issues in this stage.
        </div>
      )}
    </RoadmapLaneColumn>
  );
});

const RoadmapBoardCard = memo(function RoadmapBoardCard({
  index,
  organizationId,
  post,
}: {
  index: number;
  organizationId: string;
  post: RoadmapBoardPost;
}) {
  const navigate = useNavigate();
  const { isDragging, ref } = useSortable({
    id: post.id,
    group: post.status,
    accept: "item",
    type: "item",
    index,
    data: { statusId: post.statusId },
  });

  return (
    <SortableRoadmapIssueCard
      boardName={post.boardName}
      isDragging={isDragging}
      onClick={() =>
        navigate({
          to: "/$organizationId/post/$boardSlug/$postSlug",
          params: {
            organizationId,
            boardSlug: post.boardSlug,
            postSlug: post.slug,
          },
        })
      }
      rootRef={ref}
      status={post.status}
      title={post.title}
      updatedAt={post.updatedAt}
    />
  );
});

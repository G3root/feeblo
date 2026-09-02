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
import { formatPostStatus } from "@feeblo/web-shared/board/constants";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
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
  // Dragging an issue between lanes changes its status, which the backend
  // reserves for `posts.status` holders — disable the interaction entirely
  // for everyone else instead of letting an optimistic move fail with 403.
  const { allowed: canChangeStatus } = usePolicy(
    hasPermission(organizationId, "posts.status")
  );
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
        // SAFETY: The upstream contract guarantees a string here.
        sourceId: source.id as string,
        // SAFETY: The upstream contract guarantees a string here.
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

      // SAFETY: The upstream contract guarantees a string here.
      const targetStatusId = target?.data?.statusId as string | undefined;
      if (!targetStatusId) {
        return;
      }

      if (activeDrag.current) {
        activeDrag.current.targetStatusId = targetStatusId;
      }

      setDragPreview((currentItems) =>
        movePostToStatus(
          // SAFETY: The upstream contract guarantees a string here.
          // SAFETY: The upstream contract guarantees a string here.
          currentItems ?? lanes,
          // SAFETY: The upstream contract guarantees a string here.
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

      // SAFETY: The upstream contract guarantees a string here.
      const sourceStatusId =
        dragState?.sourceStatusId ??
        (source.data?.statusId as string | undefined);
      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      const targetStatusId =
        dragState?.targetStatusId ??
        (target?.data?.statusId as string | undefined);

      if (
        !(sourceStatusId && targetStatusId) ||
        sourceStatusId === targetStatusId
      ) {
        setDragPreview(null);
        return;
        // SAFETY: The upstream contract guarantees a string here.
        // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.
      }

      // SAFETY: The upstream contract guarantees a string here.
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
      sensors={canChangeStatus ? sensors : []}
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
  const sourceLane = lanes.find((lane) =>
    lane.posts.some((post) => post.id === postId)
  );
  const targetLane = lanes.find((lane) => lane.statusId === targetStatusId);

  if (!(sourceLane && targetLane) || sourceLane === targetLane) {
    return lanes;
  }

  const postIndex = sourceLane.posts.findIndex((post) => post.id === postId);
  if (postIndex === -1) {
    return lanes;
  }

  const post = sourceLane.posts[postIndex];
  if (!post) {
    return lanes;
  }

  return lanes.map((lane) => {
    if (lane.statusId === sourceLane.statusId) {
      return {
        ...lane,
        posts: lane.posts.filter((item) => item.id !== postId),
      };
    }

    if (lane.statusId === targetLane.statusId) {
      return {
        ...lane,
        posts: [
          ...lane.posts,
          {
            ...post,
            status: targetLane.status,
            statusId: targetLane.statusId,
          },
        ],
      };
    }

    return lane;
  });
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
            aria-label={`Add post to ${lane.name || lane.label || formatPostStatus(lane.status)}`}
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
      label={lane.label}
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
        <div className="border-border/70 bg-background/40 text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center text-sm">
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

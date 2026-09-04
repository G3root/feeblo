import { KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { hasPermission, usePolicy } from "@feeblo/web-shared/use-policy";
import { useCallback, useRef, useState } from "react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { BoardGridLaneColumn } from "./board-grid-lane-column";
import { BoardGridPostCard } from "./board-grid-post-card";
import type { BoardPostLane } from "./types";

const sensors = [
  PointerSensor.configure({
    activatorElements(source) {
      return [source.element, source.handle];
    },
  }),
  KeyboardSensor,
];

function movePostToColumn(
  lanes: BoardPostLane[],
  sourceId: string,
  targetStatusId: string
) {
  const fromLane = lanes.find((lane) =>
    lane.posts.some((post) => post.id === sourceId)
  );
  const toLane = lanes.find((lane) => lane.statusId === targetStatusId);

  if (!(fromLane && toLane) || fromLane.statusId === toLane.statusId) {
    return lanes;
  }

  const itemIndex = fromLane.posts.findIndex((post) => post.id === sourceId);

  if (itemIndex === -1) {
    return lanes;
  }

  const movedPost = fromLane.posts[itemIndex];

  if (!movedPost) {
    return lanes;
  }

  return lanes.map((lane) => {
    if (lane.statusId === fromLane.statusId) {
      return {
        ...lane,
        posts: lane.posts.filter((post) => post.id !== sourceId),
      };
    }

    if (lane.statusId === toLane.statusId) {
      return {
        ...lane,
        posts: [
          ...lane.posts,
          {
            ...movedPost,
            status: toLane.status,
            statusId: toLane.statusId,
          },
        ],
      };
    }

    return lane;
  });
}

export function BoardGridView({
  organizationId,
  boardId,
  groupedPosts,
}: {
  organizationId: string;
  boardId?: string;
  groupedPosts: BoardPostLane[];
}) {
  const { postCollection } = useDashboardCollections();
  // Dragging a post between lanes changes its status, which the backend
  // reserves for `posts.status` holders — disable the interaction entirely
  // for everyone else instead of letting an optimistic move fail with 403.
  const { allowed: canChangeStatus } = usePolicy(
    hasPermission(organizationId, "posts.status")
  );
  const [items, setItems] = useState(groupedPosts);
  const [previousGroupedPosts, setPreviousGroupedPosts] =
    useState(groupedPosts);

  if (groupedPosts !== previousGroupedPosts) {
    setPreviousGroupedPosts(groupedPosts);
    setItems(groupedPosts);
  }

  const [initialSnapshot] = useState(() => items);
  const snapshot = useRef(initialSnapshot);
  const activeDrag = useRef<{
    sourceId: string;
    sourceStatusId: string;
    targetStatusId: string | null;
  } | null>(null);

  const handleDragStart = useCallback<DragDropEventHandlers["onDragStart"]>(
    (event) => {
      // No deep clone: lane moves below are immutable (new arrays/rows),
      // so the previous state reference stays intact for cancel-rollback.
      snapshot.current = items;
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
    [items]
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

      // SAFETY: The upstream contract guarantees a string here.
      setItems((currentItems) =>
        movePostToColumn(currentItems, source.id as string, targetStatusId)
      );
    },
    []
  );

  const handleDragEnd = useCallback<DragDropEventHandlers["onDragEnd"]>(
    (event) => {
      const { source, target } = event.operation;
      const dragState = activeDrag.current;
      activeDrag.current = null;

      if (event.canceled) {
        setItems(snapshot.current);
        return;
      }

      if (source?.type !== "item") {
        setItems(snapshot.current);
        return;
      }

      // SAFETY: The upstream contract guarantees a string here.
      const sourceStatusId =
        dragState?.sourceStatusId ??
        (source.data?.statusId as string | undefined);
      const targetStatusId =
        // SAFETY: The upstream contract guarantees a string here.
        dragState?.targetStatusId ??
        (target?.data?.statusId as string | undefined);

      if (
        !(sourceStatusId && targetStatusId) ||
        sourceStatusId === targetStatusId
      ) {
        setItems(snapshot.current);
        return;
        // SAFETY: The upstream contract guarantees a string here.
      }

      // SAFETY: The runtime invariant checked by the surrounding code guarantees this type.

      const tx = postCollection.update(
        dragState?.sourceId ?? (source.id as string),
        (draft) => {
          draft.statusId = targetStatusId;
        }
      );

      void tx.isPersisted.promise.then(
        () => trackEvent("post_updated", { field: "status", success: true }),
        () => {
          trackEvent("post_updated", { field: "status", success: false });
          setItems(snapshot.current);
          toastManager.add({
            title: "Failed to update status",
            type: "error",
          });
        }
      );
    },
    [postCollection.update]
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
          {items.map((lane, columnIndex) => {
            const column = lane.status;
            const rows = lane.posts;
            const laneId = `${boardId ?? organizationId}:${columnIndex}`;
            return (
              <BoardGridLaneColumn
                boardId={boardId}
                id={laneId}
                index={columnIndex}
                key={lane.statusId}
                label={lane.label}
                status={column}
                statusId={lane.statusId}
                totalPosts={rows.length}
              >
                {rows.map((post, postIndex) => (
                  <BoardGridPostCard
                    column={column}
                    id={post.id}
                    index={postIndex}
                    key={post.id}
                    organizationId={organizationId}
                    post={post}
                    statusId={post.statusId}
                  />
                ))}
              </BoardGridLaneColumn>
            );
          })}
        </div>
      </div>
    </DragDropProvider>
  );
}

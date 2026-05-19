import { KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { useCallback, useRef, useState } from "react";
import { toastManager } from "@feeblo/ui/toast";
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
  const [items, setItems] = useState(groupedPosts);
  const [previousGroupedPosts, setPreviousGroupedPosts] =
    useState(groupedPosts);

  if (groupedPosts !== previousGroupedPosts) {
    setPreviousGroupedPosts(groupedPosts);
    setItems(groupedPosts);
  }

  const snapshot = useRef(structuredClone(items));
  const activeDrag = useRef<{
    sourceId: string;
    sourceStatusId: string;
    targetStatusId: string | null;
  } | null>(null);

  const handleDragStart = useCallback<DragDropEventHandlers["onDragStart"]>(
    (event) => {
      snapshot.current = structuredClone(items);
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
    [items]
  );

  const movePostToColumn = (
    lanes: BoardPostLane[],
    sourceId: string,
    targetStatusId: string
  ) => {
    const nextItems = structuredClone(lanes);
    const fromLane = nextItems.find((lane) =>
      lane.posts.some((post) => post.id === sourceId)
    );
    const toLane = nextItems.find((lane) => lane.statusId === targetStatusId);

    if (!(fromLane && toLane) || fromLane.statusId === toLane.statusId) {
      return lanes;
    }

    const itemIndex = fromLane.posts.findIndex((post) => post.id === sourceId);

    if (itemIndex === -1) {
      return lanes;
    }

    const [movedPost] = fromLane.posts.splice(itemIndex, 1);

    if (!movedPost) {
      return lanes;
    }

    movedPost.status = toLane.status;
    movedPost.statusId = toLane.statusId;
    toLane.posts.push(movedPost);

    return nextItems;
  };

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
        setItems(snapshot.current);
        return;
      }

      const tx = postCollection.update(
        dragState?.sourceId ?? (source.id as string),
        (draft) => {
          draft.statusId = targetStatusId;
        }
      );

      void tx.isPersisted.promise.catch(() => {
        setItems(snapshot.current);
        toastManager.add({
          title: "Failed to update status",
          type: "error",
        });
      });
    },
    []
  );

  return (
    <DragDropProvider
      onDragEnd={handleDragEnd}
      onDragOver={handleDragOver}
      onDragStart={handleDragStart}
      sensors={sensors}
    >
      <section className="overflow-x-auto pb-3">
        <div className="grid min-w-max auto-cols-max grid-flow-col gap-4 p-3">
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
                status={column}
                statusId={lane.statusId}
                totalPosts={rows.length}
              >
                {rows.map((post, postIndex) => (
                  <BoardGridPostCard
                    column={column}
                    id={post.id}
                    index={postIndex}
                    key={post.slug}
                    organizationId={organizationId}
                    post={post}
                    statusId={post.statusId}
                  />
                ))}
              </BoardGridLaneColumn>
            );
          })}
        </div>
      </section>
    </DragDropProvider>
  );
}

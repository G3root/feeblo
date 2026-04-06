import { KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { useCallback, useRef, useState } from "react";
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
  boardSlug,
  organizationId,
  boardId,
  groupedPosts,
}: {
  boardSlug: string;
  organizationId: string;
  boardId: string;
  groupedPosts: BoardPostLane[];
}) {
  const [items, setItems] = useState(groupedPosts);
  const [previousGroupedPosts, setPreviousGroupedPosts] = useState(groupedPosts);

  if (groupedPosts !== previousGroupedPosts) {
    setPreviousGroupedPosts(groupedPosts);
    setItems(groupedPosts);
  }

  const snapshot = useRef(structuredClone(items));

  const handleDragStart = useCallback<
    DragDropEventHandlers["onDragStart"]
  >(() => {
    snapshot.current = structuredClone(items);
  }, [items]);

  const movePost = (
    lanes: BoardPostLane[],
    sourceColumn: string,
    targetColumn: string,
    sourceId: string,
    targetId?: string
  ) => {
    const nextItems = structuredClone(lanes);
    const fromLane = nextItems.find((lane) => lane.status === sourceColumn);
    const toLane = nextItems.find((lane) => lane.status === targetColumn);

    if (!(fromLane && toLane)) {
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

    const targetIndex =
      targetId == null
        ? toLane.posts.length
        : toLane.posts.findIndex((post) => post.id === targetId);

    if (sourceColumn === targetColumn) {
      const insertIndex =
        targetIndex === -1 ? toLane.posts.length : Math.min(targetIndex, toLane.posts.length);
      toLane.posts.splice(insertIndex, 0, movedPost);
      return nextItems;
    }

    const insertIndex = targetIndex === -1 ? 0 : targetIndex;
    toLane.posts.splice(insertIndex, 0, movedPost);

    return nextItems;
  };

  const handleDragOver = useCallback<DragDropEventHandlers["onDragOver"]>(
    (event) => {
      const { source, target } = event.operation;

      if (source?.type === "column" || source?.type !== "item") {
        return;
      }

      const sourceColumn = source.data?.column as string | undefined;
      const targetColumn =
        target?.type === "column"
          ? (target.id as string | undefined)
          : (target?.data?.column as string | undefined);

      if (!(sourceColumn && targetColumn)) {
        return;
      }

      setItems((currentItems) =>
        movePost(
          currentItems,
          sourceColumn,
          targetColumn,
          source.id as string,
          target?.type === "item" ? (target.id as string | undefined) : undefined
        )
      );
    },
    []
  );

  const handleDragEnd = useCallback<DragDropEventHandlers["onDragEnd"]>(
    (event) => {
      if (event.canceled) {
        setItems(snapshot.current);
      }
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
            return (
              <BoardGridLaneColumn
                boardId={boardId}
                id={column}
                index={columnIndex}
                key={column}
                status={column}
                totalPosts={rows.length}
              >
                {rows.map((post, postIndex) => (
                  <BoardGridPostCard
                    boardSlug={boardSlug}
                    column={column}
                    id={post.id}
                    index={postIndex}
                    key={post.slug}
                    organizationId={organizationId}
                    post={post}
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

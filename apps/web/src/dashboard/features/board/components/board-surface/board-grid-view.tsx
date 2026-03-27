import { KeyboardSensor, PointerSensor } from "@dnd-kit/dom";
import { move } from "@dnd-kit/helpers";
import { type DragDropEventHandlers, DragDropProvider } from "@dnd-kit/react";
import { useCallback, useRef, useState } from "react";
import { BoardGridLaneColumn } from "./board-grid-lane-column";
import { BoardGridPostCard } from "./board-grid-post-card";
import type { BoardPostRow } from "./types";
import { groupPostByStatusMap } from "./utils";

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
  posts,
  boardId,
}: {
  boardSlug: string;
  organizationId: string;
  posts: BoardPostRow[];
  boardId: string;
}) {
  const [items, setItems] = useState(groupPostByStatusMap(posts));

  const [columns] = useState(Object.keys(items));

  const snapshot = useRef(structuredClone(items));

  const handleDragStart = useCallback<
    DragDropEventHandlers["onDragStart"]
  >(() => {
    snapshot.current = structuredClone(items);
  }, [items]);

  const handleDragOver = useCallback<DragDropEventHandlers["onDragOver"]>(
    (event) => {
      const { source } = event.operation;

      if (source?.type === "column") {
        // We can rely on optimistic sorting for columns
        return;
      }

      setItems((items) => move(items, event));
    },
    []
  );

  const handleDragEnd = useCallback<DragDropEventHandlers["onDragEnd"]>(
    (event) => {
      if (event.canceled) {
        setItems(snapshot.current);
        return;
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
          {columns.map((column, columnIndex) => {
            const rows = items[column as keyof typeof items];
            return (
              <BoardGridLaneColumn
                boardId={boardId}
                id={column}
                index={columnIndex}
                key={column}
                status={column as keyof typeof items}
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

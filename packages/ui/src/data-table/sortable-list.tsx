import type { DragDropEventHandlers } from "@dnd-kit/react";
import { DragDropProvider } from "@dnd-kit/react";
import { isSortable, useSortable } from "@dnd-kit/react/sortable";
import * as React from "react";

import { cn } from "../utils";

const GROUP = "data-table-list";
const TYPE = "data-table-list-item";

interface SortableListProps<TItem> {
  items: readonly TItem[];
  getItemId: (item: TItem) => string;
  onReorder: (items: TItem[]) => void;
  className?: string;
  children: (
    item: TItem,
    index: number,
    controls: { handleRef: React.Ref<HTMLElement>; isDragging: boolean }
  ) => React.ReactNode;
}

/**
 * A drag-to-reorder list for the filter and sort editors.
 *
 * Built on `@dnd-kit/react`, the same package the rest of the dashboard uses,
 * rather than the legacy `@dnd-kit/core`/`sortable` pair the shadcn registry
 * ships with. `@dnd-kit/react` is the maintained API and is already a
 * dependency here.
 *
 * The drag *preview* is the row itself, dimmed while it moves. A separate
 * overlay would need its own render of the row and a fixed size per row type.
 */
export function SortableList<TItem>({
  items,
  getItemId,
  onReorder,
  className,
  children,
}: SortableListProps<TItem>) {
  const onDragEnd: DragDropEventHandlers["onDragEnd"] = (event) => {
    const { source } = event.operation;
    if (event.canceled || !source) return;

    // The sortable source carries where the row started and where the drop
    // put it, which stays right even if the list re-renders mid-drag. Matching
    // ids to rows only works while the rows cannot move underneath the drag.
    if (!isSortable(source)) return;

    const { initialIndex, index } = source;
    if (initialIndex === index) return;

    onReorder(moveItem(items, initialIndex, index));
  };

  return (
    <DragDropProvider onDragEnd={onDragEnd}>
      <ul className={cn("flex flex-col gap-2", className)}>
        {items.map((item, index) => (
          <SortableRow id={getItemId(item)} index={index} key={getItemId(item)}>
            {(controls) => children(item, index, controls)}
          </SortableRow>
        ))}
      </ul>
    </DragDropProvider>
  );
}

interface SortableRowProps {
  id: string;
  index: number;
  children: (controls: {
    handleRef: React.Ref<HTMLElement>;
    isDragging: boolean;
  }) => React.ReactNode;
}

function SortableRow({ id, index, children }: SortableRowProps) {
  const { ref, handleRef, isDragging } = useSortable({
    accept: TYPE,
    group: GROUP,
    id,
    index,
    type: TYPE,
  });

  return (
    <li
      className={cn("list-none", isDragging && "z-10 opacity-60")}
      data-dragging={isDragging || undefined}
      ref={ref}
    >
      {children({ handleRef, isDragging })}
    </li>
  );
}

function moveItem<TItem>(items: readonly TItem[], from: number, to: number) {
  const next = [...items];
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return next;
  next.splice(to, 0, moved);
  return next;
}

import {
  ArrowDataTransferHorizontalIcon,
  Delete02Icon,
  DragDropVerticalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ColumnSort,
  type ReactTable,
  type RowData,
  type SortingState,
  Subscribe,
} from "@tanstack/react-table";
import * as React from "react";

import { Badge } from "../badge";
import { Button } from "../button";
import { Popover, PopoverPopup, PopoverTrigger } from "../popover";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../select";
import { cn } from "../utils";
import type { DataTableFeatures } from "./lib/data-table-features";
import { getIsTableShortcutTarget, SORT_ORDERS } from "./lib/data-table-utils";
import { SortableList } from "./sortable-list";

const SORT_SHORTCUT_KEY = "s";
const REMOVE_SORT_SHORTCUTS: ReadonlySet<string> = new Set([
  "backspace",
  "delete",
]);

interface DataTableSortMenuProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Multi-column sorting, edited as an ordered list.
 *
 * The order is the sort priority, so the rows drag to reorder; every row's
 * field and direction are a `Select`, and the list is the table's own sorting
 * state — a write goes straight through `table.setSorting`.
 */
export function DataTableSortMenu<TData extends RowData>(
  props: DataTableSortMenuProps<TData>
) {
  return (
    <Subscribe source={props.table.atoms.sorting}>
      {(sorting) => <DataTableSortMenuContent {...props} sorting={sorting} />}
    </Subscribe>
  );
}

function DataTableSortMenuContent<TData extends RowData>({
  table,
  disabled,
  className,
  sorting,
}: DataTableSortMenuProps<TData> & {
  sorting: SortingState;
}) {
  const descriptionId = React.useId();
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const { columnLabels, columns } = React.useMemo(() => {
    const labels = new Map<string, string>();
    const sortingIds = new Set(sorting.map((item) => item.id));
    const availableColumns: { id: string; label: string }[] = [];

    for (const column of table.getAllLeafColumns()) {
      if (!column.getCanSort()) continue;

      const label = column.columnDef.meta?.label ?? column.id;
      labels.set(column.id, label);

      if (!sortingIds.has(column.id)) {
        availableColumns.push({ id: column.id, label });
      }
    }

    return { columnLabels: labels, columns: availableColumns };
  }, [sorting, table]);

  const onSortAdd = React.useCallback(() => {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    table.setSorting((previous) => [
      ...previous,
      { desc: false, id: firstColumn.id },
    ]);
  }, [columns, table]);

  const onSortUpdate = React.useCallback(
    (sortId: string, updates: Partial<ColumnSort>) => {
      table.setSorting((previous) =>
        previous.map((sort) =>
          sort.id === sortId ? { ...sort, ...updates } : sort
        )
      );
    },
    [table]
  );

  const onSortRemove = React.useCallback(
    (sortId: string) => {
      table.setSorting((previous) =>
        previous.filter((item) => item.id !== sortId)
      );
    },
    [table]
  );

  const onSortingReset = React.useCallback(
    () => table.setSorting(table.initialState.sorting),
    [table]
  );

  React.useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (disabled) return;
      if (
        !open &&
        !getIsTableShortcutTarget(triggerRef.current, event.target)
      ) {
        return;
      }
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }

      if (
        event.key.toLowerCase() === SORT_SHORTCUT_KEY &&
        (event.ctrlKey || event.metaKey) &&
        event.shiftKey
      ) {
        event.preventDefault();
        setOpen((previous) => !previous);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, open]);

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        disabled={disabled}
        render={
          <Button
            onKeyDown={(event) => {
              if (
                REMOVE_SORT_SHORTCUTS.has(event.key.toLowerCase()) &&
                sorting.length > 0
              ) {
                event.preventDefault();
                onSortingReset();
              }
            }}
            ref={triggerRef}
            type="button"
            variant="outline"
          />
        }
      >
        <HugeiconsIcon
          className="text-muted-foreground"
          icon={ArrowDataTransferHorizontalIcon}
        />
        Sort
        {sorting.length > 0 ? (
          <Badge size="sm" variant="secondary">
            {sorting.length}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup
        aria-describedby={descriptionId}
        className={cn("w-full sm:min-w-95", className)}
        align="start"
        sideOffset={6}
      >
        <div className="flex flex-col gap-1">
          <h4 className="leading-none font-medium">
            {sorting.length > 0 ? "Sort by" : "No sorting applied"}
          </h4>
          <p className="text-muted-foreground text-sm" id={descriptionId}>
            {sorting.length > 0
              ? "Drag to change which sort is applied first."
              : "Add sorting to organize your rows."}
          </p>
        </div>
        {sorting.length > 0 ? (
          <SortableList
            className="mt-3 max-h-75 overflow-y-auto"
            getItemId={(sort) => sort.id}
            items={sorting}
            onReorder={(next) => table.setSorting(next)}
          >
            {(sort, _index, { handleRef, isDragging }) => (
              <SortRow
                columnLabels={columnLabels}
                columns={columns}
                handleRef={handleRef}
                isDragging={isDragging}
                onSortRemove={onSortRemove}
                onSortUpdate={onSortUpdate}
                sort={sort}
              />
            )}
          </SortableList>
        ) : null}
        <div className="mt-3 flex w-full items-center gap-2">
          <Button
            disabled={columns.length === 0}
            onClick={onSortAdd}
            type="button"
          >
            Add sort
          </Button>
          {sorting.length > 0 ? (
            <Button onClick={onSortingReset} type="button" variant="outline">
              Reset sorting
            </Button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

interface SortRowProps {
  sort: ColumnSort;
  columns: { id: string; label: string }[];
  columnLabels: Map<string, string>;
  isDragging: boolean;
  handleRef: React.Ref<HTMLElement>;
  onSortUpdate: (sortId: string, updates: Partial<ColumnSort>) => void;
  onSortRemove: (sortId: string) => void;
}

function SortRow({
  sort,
  columns,
  columnLabels,
  isDragging,
  handleRef,
  onSortUpdate,
  onSortRemove,
}: SortRowProps) {
  const label = columnLabels.get(sort.id) ?? sort.id;
  const items = [...columns, { id: sort.id, label }].map((column) => ({
    label: column.label,
    value: column.id,
  }));

  return (
    <div className="flex items-center gap-2">
      <Select
        items={items}
        onValueChange={(value) => {
          if (!value) return;
          onSortUpdate(sort.id, { id: value });
        }}
        value={sort.id}
      >
        <SelectTrigger aria-label={`${label} sort field`} className="w-44">
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                <bdi className="truncate">{item.label}</bdi>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <Select
        items={SORT_ORDERS}
        onValueChange={(value) => {
          if (value == null) return;
          onSortUpdate(sort.id, { desc: value === "desc" });
        }}
        value={sort.desc ? "desc" : "asc"}
      >
        <SelectTrigger
          aria-label={`${label} sort direction`}
          className="w-24 shrink-0"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {SORT_ORDERS.map((order) => (
              <SelectItem key={order.value} value={order.value}>
                {order.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <Button
        aria-label={`Remove ${label} sort`}
        className="shrink-0"
        onClick={() => onSortRemove(sort.id)}
        size="icon"
        type="button"
        variant="outline"
      >
        <HugeiconsIcon icon={Delete02Icon} />
      </Button>
      <Button
        aria-label={`Reorder ${label} sort`}
        className="shrink-0 cursor-grab active:cursor-grabbing"
        // SAFETY: `handleRef` is the sortable hook's ref for this row's
        // element, which is the `Button` rendered here.
        ref={handleRef as React.Ref<HTMLButtonElement>}
        size="icon"
        type="button"
        variant="outline"
      >
        <HugeiconsIcon
          className={cn("text-muted-foreground", isDragging && "opacity-50")}
          icon={DragDropVerticalIcon}
        />
      </Button>
    </div>
  );
}

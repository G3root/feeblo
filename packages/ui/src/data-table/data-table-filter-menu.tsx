import { LeftToRightListBulletIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactTable, RowData } from "@tanstack/react-table";
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
import { FilterRow } from "./data-table-filter-row";
import type { FilterUpdate } from "./data-table-filter-value";
import type { DataTableFeatures } from "./lib/data-table-features";
import type { ColumnFilterItem, JoinOperator } from "./lib/data-table-types";
import {
  getDefaultFilter,
  getIsTableShortcutTarget,
} from "./lib/data-table-utils";
import { createFilterId } from "./lib/id";
import { SortableList } from "./sortable-list";

const FILTER_SHORTCUT_KEY = "f";
const REMOVE_FILTER_SHORTCUTS: ReadonlySet<string> = new Set([
  "backspace",
  "delete",
]);

const JOIN_OPERATOR_ITEMS = [
  { label: "Match all conditions", value: "and" },
  { label: "Match any condition", value: "or" },
];

interface DataTableFilterMenuProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The filter editor: an ordered list of conditions, each a field, an operator
 * and a value, joined by "match all" or "match any".
 *
 * Every row edits through the table's own filter API
 * (`updateColumnFilter`/`removeColumnFilter`), which is what maps the list onto
 * the route's search params, so this menu holds no state of its own.
 */
export function DataTableFilterMenu<TData extends RowData>({
  table,
  disabled,
  className,
}: DataTableFilterMenuProps<TData>) {
  return (
    <table.Subscribe
      selector={(state) => ({
        filters: table.getColumnFilterItems(),
        joinOperator: state.joinOperator,
      })}
    >
      {({ filters, joinOperator }) => (
        <DataTableFilterMenuContent
          className={className}
          disabled={disabled}
          filters={filters}
          joinOperator={joinOperator}
          table={table}
        />
      )}
    </table.Subscribe>
  );
}

interface DataTableFilterMenuContentProps<
  TData extends RowData,
> extends DataTableFilterMenuProps<TData> {
  filters: ColumnFilterItem[];
  joinOperator: JoinOperator;
}

function DataTableFilterMenuContent<TData extends RowData>({
  table,
  filters,
  joinOperator,
  disabled,
  className,
}: DataTableFilterMenuContentProps<TData>) {
  const descriptionId = React.useId();
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const columns = React.useMemo(
    () => table.getAllLeafColumns().filter((column) => column.getCanFilter()),
    [table]
  );

  const onFilterAdd = React.useCallback(() => {
    const firstColumn = columns[0];
    if (!firstColumn) return;
    table.addColumnFilter({
      ...getDefaultFilter(firstColumn),
      filterId: createFilterId(),
    });
  }, [columns, table]);

  const onFilterUpdate = React.useCallback(
    (filterId: string, updates: FilterUpdate) =>
      table.updateColumnFilter(filterId, updates),
    [table]
  );

  const onFilterRemove = React.useCallback(
    (filterId: string) => table.removeColumnFilter(filterId),
    [table]
  );

  const onFiltersReset = React.useCallback(
    () => table.resetColumnFilters(true),
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
        event.key.toLowerCase() === FILTER_SHORTCUT_KEY &&
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
                REMOVE_FILTER_SHORTCUTS.has(event.key.toLowerCase()) &&
                filters.length > 0
              ) {
                event.preventDefault();
                onFiltersReset();
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
          icon={LeftToRightListBulletIcon}
        />
        Filter
        {filters.length > 0 ? (
          <Badge size="sm" variant="secondary">
            {filters.length}
          </Badge>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup
        aria-describedby={descriptionId}
        align="start"
        className={cn("w-full sm:min-w-140", className)}
        sideOffset={6}
      >
        <div className="flex flex-col gap-1">
          <h4 className="leading-none font-medium">
            {filters.length > 0 ? "Filter rows" : "No filters applied"}
          </h4>
          <p className="text-muted-foreground text-sm" id={descriptionId}>
            {filters.length > 0
              ? "Drag to change the order conditions are shown in."
              : "Add a filter to narrow the rows."}
          </p>
        </div>

        {filters.length > 1 ? (
          <Select
            items={JOIN_OPERATOR_ITEMS}
            onValueChange={(value) => {
              if (value == null) return;
              table.setJoinOperator(value === "or" ? "or" : "and");
            }}
            value={joinOperator}
          >
            <SelectTrigger
              aria-label="How conditions are combined"
              className="mt-3 w-full"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              <SelectGroup>
                {JOIN_OPERATOR_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        ) : null}

        {filters.length > 0 ? (
          <SortableList
            className="mt-3 max-h-75 overflow-y-auto"
            getItemId={(filter) => filter.filterId}
            items={filters}
            onReorder={(next) => table.setColumnFilters(next)}
          >
            {(filter, _index, { handleRef, isDragging }) => {
              const column = columns.find((item) => item.id === filter.id);
              if (!column) return null;

              return (
                <FilterRow
                  column={column}
                  columns={columns}
                  filter={filter}
                  handleRef={handleRef}
                  isDragging={isDragging}
                  onFilterRemove={onFilterRemove}
                  onFilterUpdate={onFilterUpdate}
                />
              );
            }}
          </SortableList>
        ) : null}

        <div className="mt-3 flex w-full items-center gap-2">
          <Button
            disabled={columns.length === 0}
            onClick={onFilterAdd}
            type="button"
          >
            Add filter
          </Button>
          {filters.length > 0 ? (
            <Button onClick={onFiltersReset} type="button" variant="outline">
              Reset filters
            </Button>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

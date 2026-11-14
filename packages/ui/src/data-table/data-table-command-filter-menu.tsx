import {
  Cancel01Icon,
  LeftToRightListBulletIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactTable, RowData } from "@tanstack/react-table";
import * as React from "react";

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
import { DataTableOptionList } from "./data-table-option-list";
import type { DataTableFeatures } from "./lib/data-table-features";
import type { ColumnFilterItem, JoinOperator } from "./lib/data-table-types";
import { getDefaultFilter } from "./lib/data-table-utils";
import { createFilterId } from "./lib/id";
import { SortableList } from "./sortable-list";

const JOIN_OPERATOR_ITEMS = [
  { label: "Match all", value: "and" },
  { label: "Match any", value: "or" },
];

interface DataTableCommandFilterMenuProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * The inline filter bar.
 *
 * Same editor as `DataTableFilterMenu`, without the popup: filters sit in the
 * toolbar, and adding one starts from a type-to-filter field list rather than
 * from a default column. That list is the "command" half — search the field by
 * name, pick it, and the row appears ready to fill in.
 */
export function DataTableCommandFilterMenu<TData extends RowData>({
  table,
  disabled,
  className,
}: DataTableCommandFilterMenuProps<TData>) {
  return (
    <table.Subscribe
      selector={(state) => ({
        filters: table.getColumnFilterItems(),
        joinOperator: state.joinOperator,
      })}
    >
      {({ filters, joinOperator }) => (
        <DataTableCommandFilterMenuContent
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

interface DataTableCommandFilterMenuContentProps<
  TData extends RowData,
> extends DataTableCommandFilterMenuProps<TData> {
  filters: ColumnFilterItem[];
  joinOperator: JoinOperator;
}

function DataTableCommandFilterMenuContent<TData extends RowData>({
  table,
  filters,
  joinOperator,
  disabled,
  className,
}: DataTableCommandFilterMenuContentProps<TData>) {
  const [open, setOpen] = React.useState(false);

  // Not memoized on `table`: the instance is stable while its columns are
  // not. A column added or removed later has to show up in the field list.
  const columns = table
    .getAllLeafColumns()
    .filter((column) => column.getCanFilter());
  const fieldItems = columns.map((column) => ({
    label: column.columnDef.meta?.label ?? column.id,
    value: column.id,
  }));

  const onFilterAdd = React.useCallback(
    (columnId: string) => {
      const column = columns.find((item) => item.id === columnId);
      if (!column) return;
      table.addColumnFilter({
        ...getDefaultFilter(column),
        filterId: createFilterId(),
      });
      setOpen(false);
    },
    [columns, table]
  );

  const onFilterUpdate = React.useCallback(
    (filterId: string, updates: FilterUpdate) =>
      table.updateColumnFilter(filterId, updates),
    [table]
  );

  const onFilterRemove = React.useCallback(
    (filterId: string) => table.removeColumnFilter(filterId),
    [table]
  );

  return (
    <div
      className={cn("flex w-full flex-col gap-2", className)}
      data-slot="data-table-command-filter-menu"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Popover onOpenChange={setOpen} open={open}>
          <PopoverTrigger
            disabled={disabled || columns.length === 0}
            render={<Button type="button" variant="outline" />}
          >
            <HugeiconsIcon
              className="text-muted-foreground"
              icon={LeftToRightListBulletIcon}
            />
            Filter
          </PopoverTrigger>
          <PopoverPopup align="start" className="w-64" sideOffset={6}>
            <DataTableOptionList
              emptyMessage="No fields found."
              items={fieldItems}
              multiple={false}
              onToggle={onFilterAdd}
              searchPlaceholder="Filter by field…"
              selectedValues={[]}
            />
          </PopoverPopup>
        </Popover>
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
              className="w-32"
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
          <Button
            aria-label="Clear filters"
            onClick={() => table.resetColumnFilters(true)}
            type="button"
            variant="ghost"
          >
            <HugeiconsIcon icon={Cancel01Icon} />
            Clear
          </Button>
        ) : null}
      </div>
      {filters.length > 0 ? (
        <SortableList
          className="w-full"
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
    </div>
  );
}

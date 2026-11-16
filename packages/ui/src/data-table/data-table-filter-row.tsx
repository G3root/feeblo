import { Delete02Icon, DragDropVerticalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Column, RowData } from "@tanstack/react-table";
import * as React from "react";

import { Button } from "../button";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../select";
import { cn } from "../utils";
import {
  DataTableFilterValue,
  type FilterUpdate,
} from "./data-table-filter-value";
import type { DataTableFeatures } from "./lib/data-table-features";
import type { ColumnFilterItem } from "./lib/data-table-types";
import {
  coerceFilterValue,
  getDefaultFilter,
  getFilterOperators,
} from "./lib/data-table-utils";

export type FilterColumn<TData extends RowData> = Column<
  DataTableFeatures,
  TData
>;

interface FilterRowProps<TData extends RowData> {
  filter: ColumnFilterItem;
  column: FilterColumn<TData>;
  columns: FilterColumn<TData>[];
  isDragging: boolean;
  handleRef: React.Ref<HTMLElement>;
  onFilterUpdate: (filterId: string, updates: FilterUpdate) => void;
  onFilterRemove: (filterId: string) => void;
}

export function FilterRow<TData extends RowData>({
  filter,
  column,
  columns,
  isDragging,
  handleRef,
  onFilterUpdate,
  onFilterRemove,
}: FilterRowProps<TData>) {
  const label = column.columnDef.meta?.label ?? column.id;
  const operatorOptions = getFilterOperators(filter.variant).map((option) => ({
    label: option.label,
    value: option.value,
  }));
  const fieldItems = columns.map((item) => ({
    label: item.columnDef.meta?.label ?? item.id,
    value: item.id,
  }));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        items={fieldItems}
        onValueChange={(columnId) => {
          const nextColumn = columns.find((item) => item.id === columnId);
          if (!nextColumn) return;
          onFilterUpdate(filter.filterId, {
            ...getDefaultFilter(nextColumn),
            id: nextColumn.id,
          });
        }}
        value={filter.id}
      >
        <SelectTrigger
          aria-label={`${label} filter field`}
          className="w-44 min-w-0"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {fieldItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <Select
        items={operatorOptions}
        onValueChange={(operator) => {
          if (operator == null) return;
          onFilterUpdate(filter.filterId, {
            operator,
            value: coerceFilterValue(operator, filter.value),
          });
        }}
        value={filter.operator}
      >
        <SelectTrigger
          aria-label={`${label} filter operator`}
          className="w-40 shrink-0 lowercase"
          size="sm"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectPopup>
          <SelectGroup>
            {operatorOptions.map((item) => (
              <SelectItem
                className="lowercase"
                key={item.value}
                value={item.value}
              >
                {item.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectPopup>
      </Select>
      <div className="min-w-40 flex-1">
        <DataTableFilterValue
          column={column}
          filter={filter}
          inputId={`${filter.filterId}-value`}
          onFilterUpdate={onFilterUpdate}
        />
      </div>
      <Button
        aria-label={`Remove ${label} filter`}
        className="shrink-0"
        onClick={() => onFilterRemove(filter.filterId)}
        size="icon"
        type="button"
        variant="outline"
      >
        <HugeiconsIcon icon={Delete02Icon} />
      </Button>
      <Button
        aria-label={`Reorder ${label} filter`}
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

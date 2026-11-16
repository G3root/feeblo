import {
  ArrowDown01Icon,
  ArrowUp01Icon,
  UnfoldMoreIcon,
  ViewOffIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type Column,
  type RowData,
  type SortDirection,
  type SortingState,
  Subscribe,
} from "@tanstack/react-table";
import * as React from "react";

import {
  Menu,
  MenuCheckboxItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../menu";
import { cn } from "../utils";
import type { DataTableFeatures } from "./lib/data-table-features";

interface DataTableColumnHeaderProps<
  TData extends RowData,
  TValue,
> extends React.ComponentProps<typeof MenuTrigger> {
  column: Column<DataTableFeatures, TData, TValue>;
  label?: string;
}

/**
 * A sortable header: the label opens a menu with the sort direction and the
 * hide action, and the trigger itself carries the current direction.
 */
export function DataTableColumnHeader<TData extends RowData, TValue>({
  column,
  label = column.columnDef.meta?.label ?? column.id,
  className,
  ...props
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort() && !column.getCanHide()) {
    return (
      <div className={cn("truncate", className)} title={label}>
        {label}
      </div>
    );
  }

  return (
    <Subscribe
      source={column.table.store}
      selector={(state) => ({
        isVisible: state.columnVisibility[column.id] !== false,
        sortDirection: getSortDirection(state.sorting, column.id),
      })}
    >
      {(headerState) => (
        <DataTableColumnHeaderMenu
          column={column}
          isVisible={headerState.isVisible}
          label={label}
          sortDirection={headerState.sortDirection}
          {...props}
          className={className}
        />
      )}
    </Subscribe>
  );
}

interface DataTableColumnHeaderMenuProps<
  TData extends RowData,
  TValue,
> extends DataTableColumnHeaderProps<TData, TValue> {
  label: string;
  isVisible: boolean;
  sortDirection: SortDirection | "none";
}

function DataTableColumnHeaderMenu<TData extends RowData, TValue>({
  column,
  label,
  className,
  isVisible,
  sortDirection,
  ...props
}: DataTableColumnHeaderMenuProps<TData, TValue>) {
  function onSortDirectionChange(direction: SortDirection) {
    if (sortDirection === direction) {
      column.clearSorting();
      return;
    }

    column.table.setSorting((prev) => {
      const sort = { id: column.id, desc: direction === "desc" };
      if (!column.getCanMultiSort()) return [sort];
      return [sort, ...prev.filter((item) => item.id !== column.id)].slice(
        0,
        column.table.options.maxMultiSortColCount
      );
    });
  }

  return (
    <Menu>
      <MenuTrigger
        className={cn(
          "hover:bg-accent focus:ring-ring data-popup-open:bg-accent [&_svg]:text-muted-foreground -ms-1.5 flex h-8 max-w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 focus:ring-1 focus:outline-none rtl:flex-row-reverse [&_svg]:size-4 [&_svg]:shrink-0",
          className
        )}
        title={label}
        {...props}
      >
        <bdi className="truncate">{label}</bdi>
        {column.getCanSort() && <SortDirectionIcon direction={sortDirection} />}
      </MenuTrigger>
      <MenuPopup align="start" className="w-40">
        {column.getCanSort() ? (
          <>
            <MenuCheckboxItem
              checked={sortDirection === "asc"}
              onCheckedChange={() => onSortDirectionChange("asc")}
            >
              Asc
            </MenuCheckboxItem>
            <MenuCheckboxItem
              checked={sortDirection === "desc"}
              onCheckedChange={() => onSortDirectionChange("desc")}
            >
              Desc
            </MenuCheckboxItem>
          </>
        ) : null}
        {column.getCanSort() && column.getCanHide() ? <MenuSeparator /> : null}
        {column.getCanHide() ? (
          <MenuCheckboxItem
            checked={!isVisible}
            onCheckedChange={() => column.toggleVisibility(false)}
          >
            <HugeiconsIcon icon={ViewOffIcon} />
            Hide
          </MenuCheckboxItem>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}

function SortDirectionIcon({
  direction,
}: {
  direction: SortDirection | "none";
}) {
  if (direction === "asc") {
    return <HugeiconsIcon icon={ArrowUp01Icon} />;
  }
  if (direction === "desc") {
    return <HugeiconsIcon icon={ArrowDown01Icon} />;
  }
  return <HugeiconsIcon icon={UnfoldMoreIcon} />;
}

function getSortDirection(
  sorting: SortingState,
  columnId: string
): SortDirection | "none" {
  const sort = sorting.find((item) => item.id === columnId);
  if (!sort) return "none";
  return sort.desc ? "desc" : "asc";
}

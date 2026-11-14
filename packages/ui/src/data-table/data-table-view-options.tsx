import { Settings05Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactTable, RowData } from "@tanstack/react-table";

import { Button } from "../button";
import { Popover, PopoverPopup, PopoverTrigger } from "../popover";
import { DataTableOptionList } from "./data-table-option-list";
import type { DataTableFeatures } from "./lib/data-table-features";

interface DataTableViewOptionsProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

/**
 * Column visibility.
 *
 * A popover with the same searchable checkbox list every filter uses, rather
 * than a menu: a table with thirty columns needs the search field more than it
 * needs `Menu`'s roving focus.
 */
export function DataTableViewOptions<TData extends RowData>({
  table,
  disabled,
  className,
}: DataTableViewOptionsProps<TData>) {
  return (
    <table.Subscribe source={table.atoms.columnVisibility}>
      {(columnVisibility) => {
        const columns = table
          .getAllLeafColumns()
          .filter(
            (column) => column.accessorFn !== undefined && column.getCanHide()
          );
        const items = columns.map((column) => ({
          label: column.columnDef.meta?.label ?? column.id,
          value: column.id,
        }));

        return (
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  aria-label="View columns"
                  className={className}
                  disabled={disabled}
                  size="sm"
                  type="button"
                  variant="outline"
                />
              }
            >
              <HugeiconsIcon
                className="text-muted-foreground"
                icon={Settings05Icon}
              />
              View
            </PopoverTrigger>
            <PopoverPopup align="end" className="w-56" sideOffset={6}>
              <DataTableOptionList
                emptyMessage="No columns found."
                items={items}
                onToggle={(columnId) => {
                  const column = columns.find((item) => item.id === columnId);
                  column?.toggleVisibility();
                }}
                searchPlaceholder="Search columns…"
                selectedValues={columns
                  .filter((column) => columnVisibility[column.id] !== false)
                  .map((column) => column.id)}
              />
            </PopoverPopup>
          </Popover>
        );
      }}
    </table.Subscribe>
  );
}

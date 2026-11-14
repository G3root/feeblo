import { isNumber, isString } from "@feeblo/utils/runtime-kind";
import {
  type ReactTable,
  type RowData,
  Subscribe,
} from "@tanstack/react-table";
import * as React from "react";

import { Input } from "../input";
import { cn } from "../utils";
import { DataTableViewOptions } from "./data-table-view-options";
import type { DataTableFeatures } from "./lib/data-table-features";

interface DataTableAdvancedToolbarProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  globalFilterPlaceholder?: string;
}

/**
 * The advanced toolbar: a search plus whatever filter controls the caller
 * composes as children (`DataTableFilterMenu`, `DataTableSortMenu`, a faceted
 * filter, …).
 */
export function DataTableAdvancedToolbar<TData extends RowData>({
  table,
  globalFilterPlaceholder,
  children,
  className,
  ...props
}: DataTableAdvancedToolbarProps<TData>) {
  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-start justify-between gap-2 p-1",
        className
      )}
      data-slot="data-table-advanced-toolbar"
      {...props}
    >
      <div className="flex min-w-[min(100%,24rem)] flex-1 flex-wrap items-center gap-2">
        {globalFilterPlaceholder &&
        table.options.enableGlobalFilter !== false ? (
          <Subscribe
            selector={(globalFilter) =>
              isString(globalFilter) || isNumber(globalFilter)
                ? String(globalFilter)
                : ""
            }
            source={table.atoms.globalFilter}
          >
            {(globalFilter) => (
              <Input
                aria-label={globalFilterPlaceholder}
                className="w-40 text-ellipsis lg:w-56"
                onChange={(event) => table.setGlobalFilter(event.target.value)}
                placeholder={globalFilterPlaceholder}
                type="search"
                value={globalFilter}
              />
            )}
          </Subscribe>
        ) : null}
        {children}
      </div>
      <div className="ms-auto flex items-center gap-2">
        <DataTableViewOptions table={table} />
      </div>
    </div>
  );
}

import { isNumber, isString } from "@feeblo/utils/runtime-kind";
import { Cancel01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type Column,
  type ReactTable,
  type RowData,
  Subscribe,
} from "@tanstack/react-table";
import * as React from "react";

import { Button } from "../button";
import { Input } from "../input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "../input-group";
import { cn } from "../utils";
import { DataTableDateFilter } from "./data-table-date-filter";
import { DataTableFacetedFilter } from "./data-table-faceted-filter";
import { DataTableSliderFilter } from "./data-table-slider-filter";
import { DataTableViewOptions } from "./data-table-view-options";
import type { DataTableFeatures } from "./lib/data-table-features";
import type { DataTableRawValue } from "./lib/data-table-types";
import {
  getColumnNumberOptions,
  getColumnSelectOptions,
  getFilterVariant,
  getIsNumberRangeColumn,
} from "./lib/data-table-utils";

const BOOLEAN_OPTIONS = [
  { label: "True", value: "true" },
  { label: "False", value: "false" },
];

interface DataTableToolbarProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  globalFilterPlaceholder?: string;
}

/**
 * The filter bar: a global search, one control per filterable column, and a
 * reset that appears only once something is filtered.
 */
export function DataTableToolbar<TData extends RowData>({
  table,
  globalFilterPlaceholder,
  children,
  className,
  ...props
}: DataTableToolbarProps<TData>) {
  const columns = React.useMemo(
    () => table.getAllLeafColumns().filter((column) => column.getCanFilter()),
    [table]
  );

  function onReset() {
    table.resetColumnFilters(true);
    table.resetJoinOperator();
    table.resetGlobalFilter(true);
  }

  return (
    <div
      className={cn(
        "flex w-full flex-wrap items-start justify-between gap-2 p-1",
        className
      )}
      data-slot="data-table-toolbar"
      {...props}
    >
      <div className="flex min-w-[min(100%,24rem)] flex-1 flex-wrap items-center gap-2">
        {globalFilterPlaceholder &&
        table.options.enableGlobalFilter !== false ? (
          <Subscribe
            selector={(globalFilter) => readFilterInputValue(globalFilter)}
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
        {columns.map((column) => (
          <DataTableToolbarFilter column={column} key={column.id} />
        ))}
        <table.Subscribe
          selector={(state) =>
            state.columnFilters.length > 0 || Boolean(state.globalFilter)
          }
        >
          {(isFiltered) =>
            isFiltered && (
              <Button
                aria-label="Reset filters"
                onClick={onReset}
                type="button"
                variant="outline"
              >
                <HugeiconsIcon icon={Cancel01Icon} />
                Reset
              </Button>
            )
          }
        </table.Subscribe>
      </div>
      <div className="ms-auto flex items-center gap-2">
        {children}
        <DataTableViewOptions table={table} />
      </div>
    </div>
  );
}

interface DataTableToolbarFilterProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData>;
}

function DataTableToolbarFilter<TData extends RowData>({
  column,
}: DataTableToolbarFilterProps<TData>) {
  const columnMeta = column.columnDef.meta;
  if (!columnMeta?.variant) return null;

  const title = columnMeta.label ?? column.id;
  const placeholder = columnMeta.placeholder ?? columnMeta.label;
  const filterVariant = getFilterVariant(columnMeta);

  switch (filterVariant) {
    case "text":
      return (
        <DataTableFilterInput
          className="w-40 text-ellipsis lg:w-56"
          column={column}
          placeholder={placeholder}
        />
      );

    case "number": {
      if (getIsNumberRangeColumn(column)) {
        return <DataTableSliderFilter column={column} title={title} />;
      }

      return (
        <DataTableFilterInput
          className="w-30"
          column={column}
          inputMode="numeric"
          placeholder={placeholder}
          type="number"
          unit={getColumnNumberOptions(columnMeta)?.unit}
        />
      );
    }

    case "date":
      return <DataTableDateFilter column={column} multiple title={title} />;

    case "select":
      return (
        <DataTableFacetedFilter
          column={column}
          multiple={columnMeta.multiple ?? true}
          options={getColumnSelectOptions(columnMeta)}
          title={title}
        />
      );

    case "boolean":
      return (
        <DataTableFacetedFilter
          column={column}
          options={BOOLEAN_OPTIONS}
          title={title}
        />
      );

    default:
      return null;
  }
}

interface DataTableFilterInputProps<TData extends RowData> extends Omit<
  React.ComponentProps<"input">,
  "size"
> {
  column: Column<DataTableFeatures, TData>;
  unit?: string | undefined;
}

function DataTableFilterInput<TData extends RowData>({
  column,
  type = "text",
  unit,
  className,
  ...props
}: DataTableFilterInputProps<TData>) {
  return (
    <Subscribe
      selector={() => column.getFilterValue()}
      source={column.table.atoms.columnFilters}
    >
      {(filterValue) => {
        const inputProps = {
          type,
          ...props,
          // SAFETY: the column's filter value is what this input writes: a
          // string, or an array of them for a multi-value filter.
          value: readFilterInputValue(filterValue as DataTableRawValue),
          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
            column.setFilterValue(event.target.value || undefined),
        };

        if (!unit) return <Input className={className} {...inputProps} />;

        return (
          <InputGroup className={className}>
            <InputGroupInput {...inputProps} />
            <InputGroupAddon align="inline-end">
              <InputGroupText>{unit}</InputGroupText>
            </InputGroupAddon>
          </InputGroup>
        );
      }}
    </Subscribe>
  );
}

function readFilterInputValue(value: DataTableRawValue) {
  if (isString(value) || isNumber(value)) return String(value);
  if (Array.isArray(value)) return value.join(",");
  return "";
}

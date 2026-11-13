import { isString } from "@feeblo/utils/runtime-kind";
import { Cancel01Icon, PlusSignCircleIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type Column, type RowData, Subscribe } from "@tanstack/react-table";
import * as React from "react";

import { Badge } from "../badge";
import { Button } from "../button";
import { Popover, PopoverPopup, PopoverTrigger } from "../popover";
import { Separator } from "../separator";
import { DataTableOptionList } from "./data-table-option-list";
import type { DataTableFeatures } from "./lib/data-table-features";
import type {
  ColumnSelectOption,
  DataTableRawValue,
} from "./lib/data-table-types";

const MAX_BADGES = 2;

interface DataTableFacetedFilterProps<TData extends RowData, TValue> {
  column?: Column<DataTableFeatures, TData, TValue> | undefined;
  title?: string;
  options: ColumnSelectOption[];
  multiple?: boolean;
}

export function DataTableFacetedFilter<TData extends RowData, TValue>({
  column,
  ...props
}: DataTableFacetedFilterProps<TData, TValue>) {
  if (!column) {
    return <DataTableFacetedFilterContent column={column} {...props} />;
  }

  return (
    <Subscribe
      selector={() => column.getFilterValue()}
      source={column.table.atoms.columnFilters}
    >
      {(filterValue) => (
        <DataTableFacetedFilterContent
          column={column}
          // SAFETY: the column's filter value is whatever this filter wrote:
          // a string or an array of strings.
          columnFilterValue={filterValue as DataTableRawValue}
          {...props}
        />
      )}
    </Subscribe>
  );
}

interface DataTableFacetedFilterContentProps<
  TData extends RowData,
  TValue,
> extends DataTableFacetedFilterProps<TData, TValue> {
  columnFilterValue?: DataTableRawValue;
}

function DataTableFacetedFilterContent<TData extends RowData, TValue>({
  column,
  title = column?.columnDef.meta?.label ?? column?.id,
  options,
  multiple = false,
  columnFilterValue,
}: DataTableFacetedFilterContentProps<TData, TValue>) {
  const selectedValues = React.useMemo(
    () =>
      Array.isArray(columnFilterValue)
        ? columnFilterValue.filter((value): value is string => isString(value))
        : [],
    [columnFilterValue]
  );
  const hasSelection = selectedValues.length > 0;

  const setValues = React.useCallback(
    (values: string[]) => {
      column?.setFilterValue(values.length > 0 ? values : undefined);
    },
    [column]
  );

  function onToggle(value: string) {
    if (!multiple) {
      setValues(selectedValues.includes(value) ? [] : [value]);
      return;
    }

    setValues(
      selectedValues.includes(value)
        ? selectedValues.filter((item) => item !== value)
        : [...selectedValues, value]
    );
  }

  const selectedOptions = selectedValues.flatMap((value) => {
    const option = options.find((item) => item.value === value);
    return option ? [option] : [];
  });

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            className="max-w-full shrink"
            type="button"
            variant="outline"
          />
        }
      >
        <FilterIcon hasSelection={hasSelection} />
        <bdi className="truncate">{title}</bdi>
        {hasSelection ? (
          <>
            <Separator
              className="mx-0.5 data-vertical:h-4 data-vertical:self-center"
              orientation="vertical"
            />
            <span className="flex min-w-0 flex-nowrap items-center gap-1">
              {selectedOptions.length > MAX_BADGES ? (
                <Badge size="sm" variant="secondary">
                  {selectedOptions.length} selected
                </Badge>
              ) : (
                selectedOptions.map((option) => (
                  <Badge
                    className="max-w-40"
                    key={option.value}
                    size="sm"
                    title={option.label}
                    variant="secondary"
                  >
                    <bdi className="truncate">{option.label}</bdi>
                  </Badge>
                ))
              )}
            </span>
          </>
        ) : null}
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-64" sideOffset={6}>
        <DataTableOptionList
          emptyMessage="No results found."
          items={options}
          onToggle={onToggle}
          searchPlaceholder={`Filter ${title ?? "values"}…`}
          selectedValues={selectedValues}
        />
        {hasSelection ? (
          <Button
            className="text-muted-foreground mt-2 w-full justify-center"
            onClick={() => setValues([])}
            size="sm"
            type="button"
            variant="ghost"
          >
            Clear filters
          </Button>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

function FilterIcon({ hasSelection }: { hasSelection: boolean }) {
  if (!hasSelection) {
    return <HugeiconsIcon icon={PlusSignCircleIcon} />;
  }

  // The clear affordance sits where the "add" icon was, so the trigger keeps
  // one width whether or not a filter is applied.
  return (
    <span
      aria-hidden="true"
      className="rounded-sm opacity-70 transition-opacity hover:opacity-100"
    >
      <HugeiconsIcon icon={Cancel01Icon} />
    </span>
  );
}

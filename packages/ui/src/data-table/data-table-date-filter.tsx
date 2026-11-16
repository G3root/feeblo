import { isNumber, isString } from "@feeblo/utils/runtime-kind";
import { Cancel01Icon, CalendarIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type Column, type RowData, Subscribe } from "@tanstack/react-table";
import * as React from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "../button";
import { Calendar } from "../calendar";
import { Popover, PopoverPopup, PopoverTrigger } from "../popover";
import { Separator } from "../separator";
import type { DataTableFeatures } from "./lib/data-table-features";
import type { DataTableRawValue } from "./lib/data-table-types";
import { formatDate } from "./lib/format";

type DateSelection = Date[] | DateRange;

interface DataTableDateFilterProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData>;
  title?: string;
  multiple?: boolean;
}

export function DataTableDateFilter<TData extends RowData>({
  column,
  ...props
}: DataTableDateFilterProps<TData>) {
  return (
    <Subscribe
      source={column.table.atoms.columnFilters}
      selector={() => column.getFilterValue()}
    >
      {(filterValue) => (
        <DataTableDateFilterContent
          column={column}
          // SAFETY: the column's filter value is whatever this filter wrote,
          // which is a date timestamp or a pair of them.
          columnFilterValue={filterValue as DataTableRawValue}
          {...props}
        />
      )}
    </Subscribe>
  );
}

function DataTableDateFilterContent<TData extends RowData>({
  column,
  title = column.columnDef.meta?.label ?? column.id,
  multiple,
  columnFilterValue,
}: DataTableDateFilterProps<TData> & {
  columnFilterValue: DataTableRawValue;
}) {
  const selectedDates = React.useMemo<DateSelection>(() => {
    if (!columnFilterValue) {
      return multiple ? { from: undefined, to: undefined } : [];
    }

    const timestamps = parseColumnFilterValue(columnFilterValue);
    if (multiple) {
      return {
        from: parseAsDate(timestamps[0]),
        to: parseAsDate(timestamps[1]),
      };
    }

    const date = parseAsDate(timestamps[0]);
    return date ? [date] : [];
  }, [columnFilterValue, multiple]);

  const onSelect = React.useCallback(
    (date: Date | DateRange | undefined) => {
      if (!date) {
        column.setFilterValue(undefined);
        return;
      }

      if (multiple && !("getTime" in date)) {
        const from = date.from ?? date.to;
        const to = date.to ?? date.from;
        if (!from || !to) {
          column.setFilterValue(undefined);
        } else if (from.toDateString() === to.toDateString()) {
          column.setFilterValue(from.getTime());
        } else {
          column.setFilterValue([from.getTime(), to.getTime()]);
        }
      } else if (!multiple && "getTime" in date) {
        column.setFilterValue(date.getTime());
      }
    },
    [column, multiple]
  );

  const onReset = React.useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      column.setFilterValue(undefined);
    },
    [column]
  );

  const hasValue = getIsDateRange(selectedDates)
    ? Boolean(selectedDates.from || selectedDates.to)
    : selectedDates.length > 0;
  const dateText = getIsDateRange(selectedDates)
    ? formatDateRange(selectedDates)
    : formatDate(selectedDates[0]);

  const label = (
    <span className="flex min-w-0 items-center gap-2">
      <bdi className="truncate">{title}</bdi>
      {hasValue && (
        <>
          <Separator
            orientation="vertical"
            className="mx-0.5 data-vertical:h-4 data-vertical:self-center"
          />
          <bdi className="truncate">{dateText}</bdi>
        </>
      )}
    </span>
  );

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
        {hasValue ? (
          <span
            aria-hidden="true"
            className="rounded-sm opacity-70 transition-opacity hover:opacity-100"
            onClick={onReset}
          >
            <HugeiconsIcon icon={Cancel01Icon} />
          </span>
        ) : (
          <HugeiconsIcon icon={CalendarIcon} />
        )}
        {label}
      </PopoverTrigger>
      <PopoverPopup
        align="start"
        aria-label={`${title} filter`}
        className="w-auto p-0"
        sideOffset={6}
      >
        {multiple ? (
          <Calendar
            autoFocus
            captionLayout="dropdown"
            mode="range"
            selected={
              getIsDateRange(selectedDates)
                ? selectedDates
                : { from: undefined, to: undefined }
            }
            onSelect={onSelect}
          />
        ) : (
          <Calendar
            captionLayout="dropdown"
            mode="single"
            selected={
              !getIsDateRange(selectedDates) ? selectedDates[0] : undefined
            }
            onSelect={onSelect}
          />
        )}
        {hasValue && (
          <div className="border-t p-3">
            <Button
              aria-label={`Clear ${title} filter`}
              className="w-full"
              onClick={onReset}
              type="button"
              variant="outline"
            >
              Clear
            </Button>
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
}

function parseColumnFilterValue(value: DataTableRawValue) {
  if (Array.isArray(value)) {
    return value.map((item) =>
      isNumber(item) || isString(item) ? item : undefined
    );
  }
  if (isString(value) || isNumber(value)) return [value];
  return [];
}

function parseAsDate(timestamp: number | string | undefined): Date | undefined {
  if (timestamp === undefined || !timestamp) return undefined;
  const numericTimestamp = isString(timestamp) ? Number(timestamp) : timestamp;
  const date = new Date(numericTimestamp);
  return !Number.isNaN(date.getTime()) ? date : undefined;
}

function getIsDateRange(value: DateSelection): value is DateRange {
  return !Array.isArray(value);
}

function formatDateRange(range: DateRange) {
  if (range.from && range.to) {
    if (range.from.toDateString() === range.to.toDateString()) {
      return formatDate(range.from);
    }
    return `${formatDate(range.from)} - ${formatDate(range.to)}`;
  }
  return formatDate(range.from ?? range.to);
}

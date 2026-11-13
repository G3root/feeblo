import { isString } from "@feeblo/utils/runtime-kind";
import { CalendarIcon, UnfoldMoreIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Column, RowData } from "@tanstack/react-table";
import * as React from "react";
import type { DateRange } from "react-day-picker";

import { Button } from "../button";
import { Calendar } from "../calendar";
import { Input } from "../input";
import { Popover, PopoverPopup, PopoverTrigger } from "../popover";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../select";
import { DataTableOptionList } from "./data-table-option-list";
import { DataTableRangeFilter } from "./data-table-range-filter";
import type { DataTableFeatures } from "./lib/data-table-features";
import type { ColumnFilterItem } from "./lib/data-table-types";
import {
  getColumnSelectOptions,
  getFilterDates,
  getFilterDateValue,
  getIsValuelessOperator,
  getSelectFilterValue,
} from "./lib/data-table-utils";

const BOOLEAN_ITEMS = [
  { label: "True", value: "true" },
  { label: "False", value: "false" },
];

export type FilterUpdate = Partial<Omit<ColumnFilterItem, "filterId">>;

interface DataTableFilterValueProps<TData extends RowData> {
  column: Column<DataTableFeatures, TData>;
  filter: ColumnFilterItem;
  inputId: string;
  onFilterUpdate: (filterId: string, updates: FilterUpdate) => void;
}

/** The value half of a filter row, chosen by the column's filter variant. */
export function DataTableFilterValue<TData extends RowData>({
  column,
  filter,
  inputId,
  onFilterUpdate,
}: DataTableFilterValueProps<TData>) {
  const columnMeta = column.columnDef.meta;
  const label = columnMeta?.label ?? column.id;

  if (getIsValuelessOperator(filter.operator)) {
    return (
      <div
        aria-label={`${label} filter is ${
          filter.operator === "isEmpty" ? "empty" : "not empty"
        }`}
        aria-live="polite"
        className="border-input dark:bg-input/30 h-8 w-full rounded-lg border border-dashed bg-transparent"
        id={inputId}
        role="status"
      />
    );
  }

  switch (filter.variant) {
    case "text":
    case "number":
      if (filter.operator === "isBetween") {
        return (
          <DataTableRangeFilter
            column={column}
            filter={filter}
            inputId={inputId}
            onFilterUpdate={onFilterUpdate}
          />
        );
      }

      return (
        <Input
          aria-label={`${label} filter value`}
          id={inputId}
          inputMode={filter.variant === "text" ? undefined : "numeric"}
          onChange={(event) =>
            onFilterUpdate(filter.filterId, { value: event.target.value })
          }
          placeholder={columnMeta?.placeholder ?? "Enter a value…"}
          type={filter.variant === "text" ? "text" : "number"}
          value={isString(filter.value) ? filter.value : ""}
        />
      );

    case "boolean":
      return (
        <Select
          items={BOOLEAN_ITEMS}
          onValueChange={(value) => {
            if (value == null) return;
            onFilterUpdate(filter.filterId, { value });
          }}
          value={isString(filter.value) ? filter.value : null}
        >
          <SelectTrigger aria-label={`${label} filter value`} id={inputId}>
            <SelectValue placeholder="Select a value" />
          </SelectTrigger>
          <SelectPopup>
            <SelectGroup>
              {BOOLEAN_ITEMS.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectPopup>
        </Select>
      );

    case "select":
      return (
        <SelectFilterValue
          column={column}
          filter={filter}
          inputId={inputId}
          onFilterUpdate={onFilterUpdate}
        />
      );

    case "date":
      return (
        <DateFilterValue
          column={column}
          filter={filter}
          inputId={inputId}
          onFilterUpdate={onFilterUpdate}
        />
      );

    default:
      return null;
  }
}

function SelectFilterValue<TData extends RowData>({
  column,
  filter,
  inputId,
  onFilterUpdate,
}: DataTableFilterValueProps<TData>) {
  const [open, setOpen] = React.useState(false);
  const options = getColumnSelectOptions(column.columnDef.meta);
  const multiple =
    filter.operator === "inArray" || filter.operator === "notInArray";
  const value = getSelectFilterValue(filter);
  const selectedValues = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  const label = column.columnDef.meta?.label ?? column.id;

  function onToggle(nextValue: string) {
    if (!multiple) {
      onFilterUpdate(filter.filterId, {
        value: selectedValues.includes(nextValue) ? "" : nextValue,
      });
      setOpen(false);
      return;
    }

    const next = selectedValues.includes(nextValue)
      ? selectedValues.filter((item) => item !== nextValue)
      : [...selectedValues, nextValue];
    onFilterUpdate(filter.filterId, { value: next });
  }

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`${label} filter value${multiple ? "s" : ""}`}
            className="w-full justify-between font-normal"
            id={inputId}
            type="button"
            variant="outline"
          />
        }
      >
        <bdi className="truncate">
          {selectedValues.length === 0
            ? (column.columnDef.meta?.placeholder ??
              `Select option${multiple ? "s" : ""}…`)
            : selectedValues.length > 1
              ? `${selectedValues.length} selected`
              : (options.find((option) => option.value === selectedValues[0])
                  ?.label ?? selectedValues[0])}
        </bdi>
        <HugeiconsIcon className="opacity-80" icon={UnfoldMoreIcon} />
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-60" sideOffset={6}>
        <DataTableOptionList
          emptyMessage="No options found."
          items={options}
          onToggle={onToggle}
          searchPlaceholder="Search options…"
          selectedValues={selectedValues}
        />
      </PopoverPopup>
    </Popover>
  );
}

function DateFilterValue<TData extends RowData>({
  column,
  filter,
  inputId,
  onFilterUpdate,
}: DataTableFilterValueProps<TData>) {
  const [open, setOpen] = React.useState(false);
  const label = column.columnDef.meta?.label ?? column.id;
  const isRange =
    filter.operator === "isBetween" || Array.isArray(filter.value);
  const [startDate, endDate] = getFilterDates(filter.value);

  function onSelect(date: Date | DateRange | undefined) {
    if (date === undefined) {
      onFilterUpdate(filter.filterId, { value: "" });
      return;
    }

    if ("getTime" in date) {
      onFilterUpdate(filter.filterId, { value: String(date.getTime()) });
      setOpen(false);
      return;
    }

    const from = date.from ?? date.to;
    const to = date.to ?? date.from;
    if (!from && !to) {
      onFilterUpdate(filter.filterId, { value: "" });
      return;
    }

    const single = from ?? to;
    if (!single) return;

    onFilterUpdate(filter.filterId, {
      value:
        from && to && from.toDateString() !== to.toDateString()
          ? [String(from.getTime()), String(to.getTime())]
          : String(single.getTime()),
    });
  }

  const valueLabel =
    getDateFilterLabel(startDate, endDate, isRange) ??
    column.columnDef.meta?.placeholder ??
    "Pick a date…";

  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger
        render={
          <Button
            aria-label={`${label} filter date`}
            className="w-full justify-start font-normal"
            id={inputId}
            type="button"
            variant="outline"
          />
        }
      >
        <HugeiconsIcon className="text-muted-foreground" icon={CalendarIcon} />
        <bdi className="truncate">{valueLabel}</bdi>
      </PopoverTrigger>
      <PopoverPopup align="start" className="w-auto p-0" sideOffset={6}>
        {isRange ? (
          <Calendar
            captionLayout="dropdown"
            mode="range"
            onSelect={onSelect}
            selected={{ from: startDate, to: endDate }}
          />
        ) : (
          <Calendar
            captionLayout="dropdown"
            mode="single"
            onSelect={onSelect}
            selected={startDate}
          />
        )}
        {startDate ? (
          <div className="border-t p-3">
            <Button
              className="w-full"
              onClick={() => onFilterUpdate(filter.filterId, { value: "" })}
              type="button"
              variant="outline"
            >
              Clear
            </Button>
          </div>
        ) : null}
      </PopoverPopup>
    </Popover>
  );
}

function getDateFilterLabel(
  startDate: Date | undefined,
  endDate: Date | undefined,
  isRange: boolean
) {
  if (!startDate) return undefined;

  const start = getFilterDateValue(startDate);
  if (!isRange || !endDate) return start;
  return `${start} – ${getFilterDateValue(endDate)}`;
}

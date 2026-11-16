import { isNumber, isPlainObject, isString } from "@feeblo/utils/runtime-kind";
import type {
  Column,
  ColumnDef,
  ColumnFilter,
  RowData,
  SortingState,
  Table,
} from "@tanstack/react-table";

import type { DataTableFeatures } from "./data-table-features";
import type {
  ColumnFilterItem,
  ColumnNumberOptions,
  ColumnSelectOption,
  DataTableColumnMeta,
  DataTableRawValue,
  FilterOperator,
  FilterOperatorOption,
  FilterVariant,
} from "./data-table-types";
export const FILTER_VARIANTS = [
  "text",
  "number",
  "date",
  "boolean",
  "select",
] as const;

export const FILTER_OPERATORS = {
  iLike: "ilike",
  notILike: "not.ilike",
  eq: "eq",
  ne: "neq",
  inArray: "in",
  notInArray: "not.in",
  isEmpty: "is.empty",
  isNotEmpty: "not.is.empty",
  lt: "lt",
  lte: "lte",
  gt: "gt",
  gte: "gte",
  isBetween: "between",
} as const;

export const JOIN_OPERATORS = ["and", "or"] as const;

export const DEFAULT_PAGE_SIZE_OPTIONS = [10, 20, 30, 40, 50] as const;

export const SORT_ORDERS = [
  { label: "Asc", value: "asc" },
  { label: "Desc", value: "desc" },
] as const;

const TEXT_OPERATORS = [
  { label: "Contains", value: "iLike" },
  { label: "Does not contain", value: "notILike" },
  { label: "Is", value: "eq" },
  { label: "Is not", value: "ne" },
  { label: "Is empty", value: "isEmpty" },
  { label: "Is not empty", value: "isNotEmpty" },
] satisfies FilterOperatorOption[];

const NUMERIC_OPERATORS = [
  { label: "Is", value: "eq" },
  { label: "Is not", value: "ne" },
  { label: "Is less than", value: "lt" },
  { label: "Is less than or equal to", value: "lte" },
  { label: "Is greater than", value: "gt" },
  { label: "Is greater than or equal to", value: "gte" },
  { label: "Is between", value: "isBetween" },
  { label: "Is empty", value: "isEmpty" },
  { label: "Is not empty", value: "isNotEmpty" },
] satisfies FilterOperatorOption[];

const DATE_OPERATORS = [
  { label: "Is", value: "eq" },
  { label: "Is not", value: "ne" },
  { label: "Is before", value: "lt" },
  { label: "Is after", value: "gt" },
  { label: "Is on or before", value: "lte" },
  { label: "Is on or after", value: "gte" },
  { label: "Is between", value: "isBetween" },
  { label: "Is empty", value: "isEmpty" },
  { label: "Is not empty", value: "isNotEmpty" },
] satisfies FilterOperatorOption[];

const SELECT_OPERATORS = [
  { label: "Has any of", value: "inArray" },
  { label: "Has none of", value: "notInArray" },
  { label: "Is", value: "eq" },
  { label: "Is not", value: "ne" },
  { label: "Is empty", value: "isEmpty" },
  { label: "Is not empty", value: "isNotEmpty" },
] satisfies FilterOperatorOption[];

const BOOLEAN_OPERATORS = [
  { label: "Is", value: "eq" },
  { label: "Is not", value: "ne" },
] satisfies FilterOperatorOption[];

const FILTER_OPERATORS_BY_VARIANT = {
  text: TEXT_OPERATORS,
  number: NUMERIC_OPERATORS,
  date: DATE_OPERATORS,
  boolean: BOOLEAN_OPERATORS,
  select: SELECT_OPERATORS,
} satisfies Record<FilterVariant, FilterOperatorOption[]>;

const CALENDAR_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

const UNBOUNDED_RANGE: [number, number] = [-Infinity, Infinity];

const DATA_TABLE_SELECTOR = '[data-slot="data-table"]';

export function getColumnId<TData extends RowData>(
  column: ColumnDef<DataTableFeatures, TData>
) {
  const accessorKey = "accessorKey" in column ? column.accessorKey : undefined;
  return (
    column.id ??
    (accessorKey === undefined
      ? undefined
      : String(accessorKey).replaceAll(".", "_")) ??
    (isString(column.header) ? column.header : undefined)
  );
}

export function getFilterVariant(
  meta: DataTableColumnMeta | undefined
): FilterVariant {
  const variant = meta?.variant;
  return FILTER_VARIANTS.find((item) => item === variant) ?? "text";
}

export function getColumnNumberOptions(
  meta: DataTableColumnMeta | undefined
): ColumnNumberOptions | undefined {
  return meta?.variant === "number" ? meta : undefined;
}

export function getIsNumberRangeColumn<TData extends RowData>(
  column: Column<DataTableFeatures, TData>
) {
  const options = getColumnNumberOptions(column.columnDef.meta);
  if (isNumber(options?.min) && isNumber(options.max)) {
    return true;
  }
  return !column.table.options.manualFiltering;
}

export function getColumnSelectOptions(
  meta: DataTableColumnMeta | undefined
): ColumnSelectOption[] {
  return meta?.variant === "select" ? (meta.options ?? []) : [];
}

export function getDefaultFilter<TData extends RowData>(
  column: Column<DataTableFeatures, TData>
) {
  const variant = getFilterVariant(column.columnDef.meta);

  return {
    id: column.id,
    variant,
    operator: getDefaultFilterOperator(variant),
    value: "",
  };
}

export function getFilterOperators(filterVariant: FilterVariant) {
  return FILTER_OPERATORS_BY_VARIANT[filterVariant] ?? [];
}

export function getDefaultFilterOperator(filterVariant: FilterVariant) {
  const operators = getFilterOperators(filterVariant);

  return operators[0]?.value ?? (filterVariant === "text" ? "iLike" : "eq");
}

export function getPlainFilterOperator(
  variant: FilterVariant,
  isList: boolean
): FilterOperator {
  if (variant === "select") return "inArray";
  if (isList && (variant === "number" || variant === "date")) {
    return "isBetween";
  }
  return variant === "text" ? "iLike" : "eq";
}

export function getIsValuelessOperator(operator: FilterOperator) {
  return operator === "isEmpty" || operator === "isNotEmpty";
}

export function coerceFilterValue(
  operator: FilterOperator,
  value: string | string[]
) {
  if (getIsValuelessOperator(operator)) return "";

  if (operator === "inArray" || operator === "notInArray") {
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  }

  if (operator === "isBetween") {
    return Array.isArray(value) ? value : [value, ""];
  }

  if (Array.isArray(value)) return value.find((item) => item !== "") ?? "";

  return value;
}

export function getSelectFilterValue(filter: ColumnFilterItem) {
  if (filter.operator === "inArray" || filter.operator === "notInArray") {
    return Array.isArray(filter.value) ? filter.value : [];
  }

  return isString(filter.value) ? filter.value : undefined;
}

export function stringifyFilterValue(value: DataTableRawValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (isPlainObject(value) || Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

export function getPlainFilterId(columnId: string) {
  return `${columnId}-filter`;
}

export function getIsPlainFilter(filter: ColumnFilterItem) {
  return (
    filter.operator ===
    getPlainFilterOperator(filter.variant, Array.isArray(filter.value))
  );
}

export function createPlainFilter<TColumnId extends string>(
  id: TColumnId,
  variant: FilterVariant,
  value: DataTableRawValue
): ColumnFilterItem<TColumnId> | null {
  if (value === undefined || value === null || value === "") return null;

  if (variant === "boolean" && Array.isArray(value)) {
    if (value.length !== 1) return null;
    return createPlainFilter(id, variant, value[0]);
  }

  const operator = getPlainFilterOperator(variant, Array.isArray(value));
  const filterId = getPlainFilterId(id);
  const stringify = getFilterValueStringifier(variant);

  if (operator === "inArray" || operator === "isBetween") {
    const values = normalizeFilterValues(
      variant,
      operator,
      (Array.isArray(value) ? value : [value]).map(stringify)
    );
    if (values.every((item) => item === "")) return null;
    return { id, variant, operator, value: values, filterId };
  }

  if (Array.isArray(value)) return null;

  return { id, variant, operator, value: stringify(value), filterId };
}

export function normalizeColumnFilter(
  filter: ColumnFilter,
  variant: FilterVariant
): ColumnFilterItem {
  const filterId = filter.filterId ?? getPlainFilterId(filter.id);
  // SAFETY: TanStack types a stored filter value as `unknown`; every writer is
  // this file's `createPlainFilter` or the URL parsers, which store a raw value.
  const rawValue = filter.value as DataTableRawValue;

  if (filter.operator) {
    const filterVariant = filter.variant ?? variant;
    const stringify = getFilterValueStringifier(filterVariant);

    return {
      id: filter.id,
      variant: filterVariant,
      operator: filter.operator,
      value: Array.isArray(rawValue)
        ? normalizeFilterValues(
            filterVariant,
            filter.operator,
            rawValue.map(stringify)
          )
        : stringify(rawValue),
      filterId,
    };
  }

  const item = createPlainFilter(filter.id, variant, rawValue);
  if (item) return { ...item, filterId };

  return {
    id: filter.id,
    variant,
    operator: getPlainFilterOperator(variant, false),
    value: variant === "select" ? [] : "",
    filterId,
  };
}

export function getPlainFilterValue(
  filter: ColumnFilterItem
): DataTableRawValue {
  const { variant, value } = filter;

  if (variant === "select") {
    return Array.isArray(value) ? value : [value];
  }

  if (variant === "number") {
    return Array.isArray(value)
      ? value.map((item) => (item === "" ? undefined : Number(item)))
      : value;
  }

  if (variant === "date") {
    return Array.isArray(value)
      ? value.map((item) => parseFilterDate(item)?.getTime())
      : parseFilterDate(value)?.getTime();
  }

  if (variant === "boolean") return [value];

  return value;
}

// The feature's `setColumnFilters` turns every filter into a
// `ColumnFilterItem` on the way in, so the state only holds items.
export function asFilterItems(filters: ColumnFilter[]): ColumnFilterItem[] {
  // SAFETY: every filter in the table's state passed through
  // `normalizeColumnFilter` in `onColumnFiltersChange`, which fills in the
  // variant, operator and filterId that `ColumnFilter` leaves partial.
  return filters as ColumnFilterItem[];
}

export function getIsActiveFilter(filter: ColumnFilterItem) {
  return (
    getIsValuelessOperator(filter.operator) ||
    (Array.isArray(filter.value)
      ? filter.value.some((value) => value !== "")
      : filter.value !== "")
  );
}

export function getActiveFilters<TFilterItem extends ColumnFilterItem>(
  filters: TFilterItem[]
): TFilterItem[] {
  return filters.filter(getIsActiveFilter);
}

export function getActiveFiltersKey(filters: ColumnFilterItem[]) {
  return JSON.stringify(
    getActiveFilters(filters)
      .map((filter) =>
        JSON.stringify([filter.id, filter.operator, filter.value])
      )
      .sort()
  );
}

export function getIsValidFilterValue(filter: ColumnFilterItem) {
  if (getIsValuelessOperator(filter.operator)) return true;

  const values = Array.isArray(filter.value) ? filter.value : [filter.value];

  switch (filter.variant) {
    case "number":
      return values.every(
        (value) => value.trim() === "" || Number.isFinite(Number(value))
      );
    case "date":
      return values.every(
        (value) => value === "" || parseFilterDate(value) !== undefined
      );
    case "boolean":
      return values.every((value) => value === "true" || value === "false");
    default:
      return true;
  }
}

export function parseFilterDate(value: DataTableRawValue): Date | undefined {
  if (value instanceof Date) return getValidDate(value);
  if (isNumber(value)) return getValidDate(new Date(value));
  if (!isString(value) || value.trim() === "") return undefined;

  const text = value.trim();
  const match = CALENDAR_DATE_PATTERN.exec(text);
  if (match) {
    const [, year, month, day] = match.map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      return undefined;
    }
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year &&
      date.getMonth() === month - 1 &&
      date.getDate() === day
      ? date
      : undefined;
  }

  const numeric = Number(text);
  return getValidDate(new Date(Number.isNaN(numeric) ? text : numeric));
}

export function formatFilterDate(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function getFilterDates(value: ColumnFilterItem["value"]) {
  return (Array.isArray(value) ? value : [value]).flatMap((item) => {
    const date = parseFilterDate(item);
    return date ? [date] : [];
  });
}

export function getFilterDateValue(date: Date | undefined) {
  return date ? formatFilterDate(date) : "";
}

export function getRangeFilterBounds(
  values: [string, string],
  [min, max]: [number, number] = UNBOUNDED_RANGE
): [number | undefined, number | undefined] {
  const [start, end] = values.map((value) => {
    const number = Number(value);
    return value.trim() === "" || Number.isNaN(number)
      ? undefined
      : Math.min(Math.max(number, min), max);
  });

  return start !== undefined && end !== undefined && start > end
    ? [end, start]
    : [start, end];
}

export function getValidRangeFilterBounds(
  values: [string, string],
  [min, max]: [number, number] = UNBOUNDED_RANGE
): [number | undefined, number | undefined] | null {
  const [start, end] = values.map((value) =>
    value.trim() === "" ? undefined : Number(value)
  );

  for (const bound of [start, end]) {
    if (bound === undefined) continue;
    if (Number.isNaN(bound) || bound < min || bound > max) return null;
  }
  if (start !== undefined && end !== undefined && start > end) return null;

  return [start, end];
}

export function getAriaSort(
  sorting: SortingState,
  columnId: string
): React.AriaAttributes["aria-sort"] {
  const sort = sorting[0];
  if (sort?.id !== columnId) return undefined;
  return sort.desc ? "descending" : "ascending";
}

export function getVisibleSelectedRows<TData extends RowData>(
  table: Table<DataTableFeatures, TData>
) {
  return table.getRowModel().rows.filter((row) => row.getIsSelected());
}

export function getColumnPinningStyle<TData extends RowData>(
  column: Column<DataTableFeatures, TData>,
  isPinned = column.getIsPinned()
): React.CSSProperties {
  return {
    insetInlineStart:
      isPinned === "start"
        ? `var(${getColumnVar(column.id, "offset")})`
        : undefined,
    insetInlineEnd:
      isPinned === "end"
        ? `var(${getColumnVar(column.id, "offset")})`
        : undefined,
    position: isPinned ? "sticky" : "relative",
    width: `var(${getColumnVar(column.id, "size")})`,
    zIndex: isPinned ? 20 : undefined,
  };
}

export function getColumnSizingStyle<TData extends RowData>(
  table: Table<DataTableFeatures, TData>
): React.CSSProperties {
  // A `Map` rather than an object literal because the keys are CSS custom
  // properties, which no object type in this file enumerates.
  const style = new Map<string, string>([
    ["minWidth", `${table.getTotalSize()}px`],
  ]);

  for (const header of table.getFlatHeaders()) {
    style.set(getColumnVar(header.column.id, "size"), `${header.getSize()}px`);
  }

  for (const { column } of table.getLeafHeaders()) {
    const isPinned = column.getIsPinned();
    if (!isPinned) continue;

    const offset =
      isPinned === "start" ? column.getStart("start") : column.getAfter("end");
    style.set(getColumnVar(column.id, "offset"), `${offset}px`);
  }

  // SAFETY: every entry is a CSS custom property (`--column-…`) or a known
  // style key, and every value is a length in `px`; `React.CSSProperties`
  // accepts an index signature it does not model for custom properties.
  return Object.fromEntries(style) as React.CSSProperties;
}

export function getIsTableShortcutTarget(
  element: Element | null,
  target: EventTarget | null
) {
  const root = element?.closest(DATA_TABLE_SELECTOR);
  if (!root) return true;

  const targetRoot =
    target instanceof Element ? target.closest(DATA_TABLE_SELECTOR) : null;
  if (targetRoot) return targetRoot === root;

  return document.querySelector(DATA_TABLE_SELECTOR) === root;
}

function getColumnVar(columnId: string, property: "size" | "offset") {
  const name = columnId.replace(
    /[^a-zA-Z0-9-]/g,
    (char) => `_${char.codePointAt(0)?.toString(16)}_`
  );
  return `--column-${name}-${property}`;
}

function getValidDate(date: Date) {
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function normalizeFilterValues(
  variant: FilterVariant,
  operator: FilterOperator,
  values: string[]
) {
  if (operator !== "isBetween") return values;

  if (variant === "date") {
    const [start = "", end = ""] = values;
    const startTime = parseFilterDate(start)?.getTime();
    const endTime = parseFilterDate(end)?.getTime();
    return startTime !== undefined &&
      endTime !== undefined &&
      startTime > endTime
      ? [end, start]
      : [start, end];
  }

  if (variant !== "number") return values;

  const [start = "", end = ""] = values.map((value) => {
    const trimmed = value.trim();
    return trimmed === "" || Number.isNaN(Number(trimmed)) ? "" : trimmed;
  });

  return start !== "" && end !== "" && Number(start) > Number(end)
    ? [end, start]
    : [start, end];
}

function getFilterValueStringifier(variant: FilterVariant) {
  return variant === "date" ? stringifyFilterDate : stringifyFilterValue;
}

function stringifyFilterDate(value: DataTableRawValue) {
  const date = parseFilterDate(value);
  return date ? formatFilterDate(date) : "";
}

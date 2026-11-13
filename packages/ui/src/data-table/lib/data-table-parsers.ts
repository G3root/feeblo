import { isBoolean, isNumber, isString } from "@feeblo/utils/runtime-kind";

import type {
  ColumnFilterItem,
  ColumnSortItem,
  DataTableRawValue,
  FilterOperator,
  FilterVariant,
} from "./data-table-types";
import {
  FILTER_OPERATORS,
  getFilterOperators,
  getIsActiveFilter,
  getIsValidFilterValue,
  getIsValuelessOperator,
  getPlainFilterOperator,
  normalizeColumnFilter,
} from "./data-table-utils";

/**
 * A route's search params, as TanStack Router hands them back from
 * `location.search`. Values are whatever the router's `parseSearch` produced:
 * strings for plain keys, arrays for a key repeated in the query string.
 */
export interface DataTableSearchRecord {
  [key: string]: DataTableRawValue;
}

const OPERATORS_BY_NAME = new Map(
  getKeys(FILTER_OPERATORS).flatMap((operator): [string, FilterOperator][] => [
    [FILTER_OPERATORS[operator], operator],
    [operator.toLowerCase(), operator],
  ])
);

const MAX_OPERATOR_PART_COUNT = 3;

const LIST_OPERATORS = new Set<FilterOperator>([
  "inArray",
  "notInArray",
  "isBetween",
]);

/**
 * Reads one search key as a string, whichever shape the router produced.
 *
 * The default `parseSearch` JSON-parses a value that looks like JSON, so
 * `?page=2` arrives as the number `2` rather than `"2"`. Formatting it back to
 * a string keeps every parser below working on one type.
 */
export function getSearchString(value: DataTableRawValue): string | undefined {
  if (isString(value)) return value;
  if (isNumber(value) && Number.isFinite(value)) return String(value);
  if (isBoolean(value)) return String(value);
  return undefined;
}

/** Reads a search key that may be repeated, as `?key=a&key=b`. */
export function getSearchStrings(value: DataTableRawValue): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const text = getSearchString(item);
      return text === undefined ? [] : [text];
    });
  }

  const text = getSearchString(value);
  return text === undefined ? [] : [text];
}

/**
 * Parses the `sort` key.
 *
 * The form is `title.asc,createdAt.desc`: ids are percent-encoded, so an id
 * containing a comma or a dot still round-trips, and the direction is the
 * segment after the final dot.
 */
export function parseSorting(
  value: DataTableRawValue,
  columnIds?: readonly string[] | Set<string>
): ColumnSortItem[] | null {
  const sorting = parseSortingValue(getSearchString(value));
  if (!sorting) return null;

  const knownIds = columnIds === undefined ? null : new Set(columnIds);
  return knownIds === null || sorting.every((item) => knownIds.has(item.id))
    ? sorting
    : null;
}

export function serializeSorting(
  sorting: ColumnSortItem[]
): string | undefined {
  if (sorting.length === 0) return undefined;

  return sorting
    .map(
      (item) => `${encodeURIComponent(item.id)}.${item.desc ? "desc" : "asc"}`
    )
    .join(",");
}

export function parseColumnFilter<TColumnId extends string>(
  id: TColumnId,
  variant: FilterVariant,
  param: string
): ColumnFilterItem<TColumnId> {
  const { operator, rawValue } = splitFilterOperator(param, variant);

  const filter = normalizeColumnFilter(
    {
      id,
      variant,
      operator,
      value: getIsValuelessOperator(operator)
        ? ""
        : LIST_OPERATORS.has(operator)
          ? parseListValue(rawValue, operator)
          : rawValue,
    },
    variant
  );

  return { ...filter, id };
}

/**
 * Parses every value of one filter key. A value that is not a usable filter is
 * dropped rather than kept, so `?title=` reads as no filter.
 */
export function parseColumnFilters<TColumnId extends string>(
  id: TColumnId,
  variant: FilterVariant,
  value: DataTableRawValue
): ColumnFilterItem<TColumnId>[] {
  return getSearchStrings(value).flatMap((param) => {
    const filter = parseColumnFilter(id, variant, param);
    return getIsActiveFilter(filter) && getIsValidFilterValue(filter)
      ? [filter]
      : [];
  });
}

export function serializeColumnFilter(filter: ColumnFilterItem): string {
  const name = FILTER_OPERATORS[filter.operator];
  if (getIsValuelessOperator(filter.operator)) return name;

  const rawValue = Array.isArray(filter.value)
    ? joinListValue(filter.value)
    : filter.value;

  if (
    filter.operator ===
    getPlainFilterOperator(filter.variant, Array.isArray(filter.value))
  ) {
    const implicit = parseColumnFilter(filter.id, filter.variant, rawValue);
    if (getIsSameFilter(implicit, filter)) return rawValue;
  }

  return `${name}.${rawValue}`;
}

function parseSortingValue(value: string | undefined): ColumnSortItem[] | null {
  if (value === undefined || value === "") return [];

  const sorting: ColumnSortItem[] = [];

  for (const part of value.split(",")) {
    const index = part.lastIndexOf(".");
    const order = part.slice(index + 1);

    if (index <= 0 || (order !== "asc" && order !== "desc")) return null;

    const decoded = decodeComponent(part.slice(0, index));
    if (decoded === undefined) return null;

    sorting.push({ id: decoded, desc: order === "desc" });
  }

  return sorting;
}

/**
 * `decodeURIComponent`, treating a malformed sequence as "not this value"
 * rather than throwing a URIError through the table's render.
 */
function decodeComponent(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

function splitFilterOperator(param: string, variant: FilterVariant) {
  const parts = param.split(".");

  for (
    let count = Math.min(MAX_OPERATOR_PART_COUNT, parts.length);
    count > 0;
    count--
  ) {
    const operator = OPERATORS_BY_NAME.get(
      parts.slice(0, count).join(".").toLowerCase()
    );
    if (!operator || !getIsVariantOperator(variant, operator)) continue;
    if (count === parts.length && !getIsValuelessOperator(operator)) continue;

    return { operator, rawValue: parts.slice(count).join(".") };
  }

  return {
    operator: getPlainFilterOperator(variant, param.includes(",")),
    rawValue: param,
  };
}

function getIsVariantOperator(
  variant: FilterVariant,
  operator: FilterOperator
) {
  return getFilterOperators(variant).some(
    (option) => option.value === operator
  );
}

function parseListValue(rawValue: string, operator: FilterOperator) {
  const items: string[] = [];
  let item = "";
  let isQuoted = false;
  let wasQuoted = false;

  for (let index = 0; index < rawValue.length; index++) {
    const char = rawValue[index];

    if (char === '"') {
      if (isQuoted && rawValue[index + 1] === '"') {
        item += char;
        index++;
      } else {
        isQuoted = !isQuoted;
        wasQuoted = true;
      }
    } else if (char === "," && !isQuoted) {
      items.push(wasQuoted ? item : item.trim());
      item = "";
      wasQuoted = false;
    } else {
      item += char;
    }
  }
  if (rawValue !== "") items.push(wasQuoted ? item : item.trim());

  if (operator === "isBetween") return [items[0] ?? "", items[1] ?? ""];
  return items.filter((value) => value !== "");
}

function joinListValue(values: string[]) {
  return values
    .map((value) =>
      /[,"]/.test(value) || value !== value.trim()
        ? `"${value.replaceAll('"', '""')}"`
        : value
    )
    .join(",");
}

function getIsSameFilter(a: ColumnFilterItem, b: ColumnFilterItem) {
  if (a.operator !== b.operator) return false;
  if (!Array.isArray(a.value) || !Array.isArray(b.value)) {
    return a.value === b.value;
  }
  const otherValue = b.value;
  return (
    a.value.length === otherValue.length &&
    a.value.every((item, index) => item === otherValue[index])
  );
}

function getKeys<TKey extends string>(record: Record<TKey, DataTableRawValue>) {
  return Object.keys(record).filter((key): key is TKey =>
    Object.hasOwn(record, key)
  );
}

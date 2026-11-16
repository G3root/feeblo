import { isString } from "@feeblo/utils/runtime-kind";
import type { ColumnDef, RowData } from "@tanstack/react-table";

import type { DataTableFeatures } from "./data-table-features";
import {
  getSearchString,
  parseColumnFilters,
  parseSorting,
  serializeColumnFilter,
  serializeSorting,
  type DataTableSearchRecord,
} from "./data-table-parsers";
import type {
  ColumnFilterItem,
  ColumnSortItem,
  DataTableColumnConfig,
  DataTableColumnConfigs,
  DataTableQuery,
  DataTableRawValue,
  FilterableColumnId,
  FilterVariant,
  JoinOperator,
  SortableColumnId,
} from "./data-table-types";
import {
  DEFAULT_PAGE_SIZE_OPTIONS,
  getColumnId,
  getFilterVariant,
  JOIN_OPERATORS,
} from "./data-table-utils";

const DEFAULT_PAGE_SIZE = 10;

const DATA_TABLE_KEYS = [
  "page",
  "perPage",
  "sort",
  "joinOperator",
  "search",
] as const;

type DataTableKey = (typeof DATA_TABLE_KEYS)[number];

type KnownColumnConfigs<TColumns> = {
  [K in keyof TColumns]: Record<
    Exclude<keyof TColumns[K], keyof DataTableColumnConfig>,
    never
  >;
};

type ConfigQuery<TColumns extends DataTableColumnConfigs> = DataTableQuery<
  FilterableColumnId<TColumns>,
  SortableColumnId<TColumns>
>;

export interface DataTableConfigOptions<
  TColumns extends DataTableColumnConfigs,
> {
  id?: string | undefined;
  columns: TColumns & KnownColumnConfigs<TColumns>;
  defaultSorting?: ColumnSortItem<NoInfer<SortableColumnId<TColumns>>>[];
  defaultPageSize?: number;
  pageSizeOptions?: readonly number[];
  defaultJoinOperator?: JoinOperator;
  enableGlobalFilter?: boolean;
}

export interface DataTableConfig<
  TColumns extends DataTableColumnConfigs = DataTableColumnConfigs,
> {
  readonly id: string | undefined;
  readonly columns: TColumns;
  readonly defaultSorting: ColumnSortItem<SortableColumnId<TColumns>>[];
  readonly defaultPageSize: number;
  readonly pageSizeOptions: readonly number[];
  readonly defaultJoinOperator: JoinOperator;
  readonly enableGlobalFilter: boolean;
  readonly filterVariants: Readonly<Record<string, FilterVariant>>;
  readonly urlKeys: Record<DataTableKey | FilterableColumnId<TColumns>, string>;
  /** Reads the table's slice of a route's search params. */
  parse(search: DataTableSearchRecord): ConfigQuery<TColumns>;
  /**
   * Writes the table's slice back into a search record, leaving every key the
   * table does not own untouched.
   *
   * A key whose value is the default is removed rather than written, so the
   * URL stays as short as the state actually is.
   */
  apply(
    search: DataTableSearchRecord,
    query: Partial<ConfigQuery<TColumns>>
  ): DataTableSearchRecord;
}

export type DataTableConfigInput = Omit<
  DataTableConfigOptions<DataTableColumnConfigs>,
  "columns"
>;

export function createDataTableConfig<
  const TColumns extends DataTableColumnConfigs,
>({
  id,
  columns,
  defaultSorting = [],
  defaultPageSize = DEFAULT_PAGE_SIZE,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  defaultJoinOperator = "and",
  enableGlobalFilter = true,
}: DataTableConfigOptions<TColumns>): DataTableConfig<TColumns> {
  if (id === "") {
    throw new Error("Data table id must not be empty.");
  }

  const filterVariants = getFilterVariants(columns);
  const filterableIds = getKeys(filterVariants);
  const reservedId = filterableIds.find(getIsDataTableKey);
  if (reservedId !== undefined) {
    throw new Error(
      `Data table column id "${reservedId}" is reserved for the ${reservedId} query key. Rename the column or turn off its filter.`
    );
  }

  const sortableIds = getSortableIds<TColumns>(columns);
  const prefix = id === undefined ? "" : `${id}.`;
  const urlKeyOf = (key: string) => `${prefix}${key}`;

  const defaultQuery: ConfigQuery<TColumns> = {
    page: 1,
    perPage: defaultPageSize,
    sorting: defaultSorting,
    filters: [],
    joinOperator: defaultJoinOperator,
    globalFilter: "",
  };

  return Object.freeze({
    id,
    columns,
    defaultSorting,
    defaultPageSize,
    pageSizeOptions,
    defaultJoinOperator,
    enableGlobalFilter,
    filterVariants,
    // SAFETY: `fromKeys` maps every key of `DATA_TABLE_KEYS | filterableIds`
    // through the same prefixing `urlKeyOf` applies in `parse`/`apply`.
    urlKeys: fromKeys(
      [...DATA_TABLE_KEYS, ...filterableIds],
      urlKeyOf
    ) as DataTableConfig<TColumns>["urlKeys"],
    parse(search: DataTableSearchRecord) {
      const maxPageSize = Math.max(defaultPageSize, ...pageSizeOptions);

      return {
        page: parseInteger(search[urlKeyOf("page")], 1, 1),
        perPage: parseInteger(
          search[urlKeyOf("perPage")],
          defaultPageSize,
          1,
          maxPageSize
        ),
        // SAFETY: `parseSorting` was given `sortableIds`, so every id it
        // returns is one of the config's sortable columns.
        sorting: (parseSorting(search[urlKeyOf("sort")], sortableIds) ??
          defaultSorting) as ColumnSortItem<SortableColumnId<TColumns>>[],
        // SAFETY: `filterableIds` is exactly the config's filterable columns,
        // so every id in the list is a `FilterableColumnId`.
        filters: filterableIds.flatMap((columnId) =>
          parseColumnFilters(
            columnId,
            filterVariants[columnId] ?? "text",
            search[urlKeyOf(columnId)]
          ).map((filter, index) => ({
            ...filter,
            // Filters of one column share the URL key, so the column id alone
            // is not unique; the row's position in that key is what
            // `removeColumnFilter` receives.
            filterId: `${columnId}-${index}`,
          }))
        ) as ColumnFilterItem<FilterableColumnId<TColumns>>[],
        joinOperator: getJoinOperator(
          search[urlKeyOf("joinOperator")],
          defaultJoinOperator
        ),
        globalFilter: enableGlobalFilter
          ? (getSearchString(search[urlKeyOf("search")]) ?? "")
          : "",
      };
    },
    apply(
      search: DataTableSearchRecord,
      query: Partial<ConfigQuery<TColumns>>
    ) {
      const next: DataTableSearchRecord = { ...search };
      const write = (key: string, value: DataTableRawValue) => {
        if (value === undefined) delete next[key];
        else next[key] = value;
      };

      const page = query.page ?? defaultQuery.page;
      const perPage = query.perPage ?? defaultQuery.perPage;
      const sorting = query.sorting ?? defaultQuery.sorting;
      const joinOperator = query.joinOperator ?? defaultQuery.joinOperator;
      const globalFilter = query.globalFilter ?? defaultQuery.globalFilter;
      const filters = query.filters ?? defaultQuery.filters;

      write(urlKeyOf("page"), page === defaultQuery.page ? undefined : page);
      write(
        urlKeyOf("perPage"),
        perPage === defaultQuery.perPage ? undefined : perPage
      );
      write(urlKeyOf("sort"), serializeSorting(sorting));
      write(
        urlKeyOf("joinOperator"),
        joinOperator === defaultJoinOperator ? undefined : joinOperator
      );
      write(urlKeyOf("search"), globalFilter === "" ? undefined : globalFilter);

      const filtersByColumn = new Map<string, ColumnFilterItem[]>();
      for (const filter of filters) {
        filtersByColumn.set(filter.id, [
          ...(filtersByColumn.get(filter.id) ?? []),
          filter,
        ]);
      }

      for (const columnId of filterableIds) {
        const columnFilters = filtersByColumn.get(columnId);
        write(
          urlKeyOf(columnId),
          columnFilters?.length
            ? columnFilters.map((filter) => serializeColumnFilter(filter))
            : undefined
        );
      }

      return next;
    },
  });
}

export function getIsDataTableConfig(
  config: DataTableConfigInput | DataTableConfig | undefined
): config is DataTableConfig {
  return config !== undefined && "parse" in config && "apply" in config;
}

export function applyColumnConfig<TData extends RowData>(
  column: ColumnDef<DataTableFeatures, TData>,
  configs: DataTableColumnConfigs
): ColumnDef<DataTableFeatures, TData> {
  if (getIsGroupColumn(column)) {
    return {
      ...column,
      columns: column.columns.map((child) => applyColumnConfig(child, configs)),
    };
  }

  const columnId = getColumnId(column);
  const config =
    columnId !== undefined && Object.hasOwn(configs, columnId)
      ? configs[columnId]
      : undefined;
  if (!config) {
    return { ...column, enableColumnFilter: false, enableSorting: false };
  }
  const { enableSorting, ...meta } = config;

  return {
    ...column,
    enableColumnFilter: config.variant !== undefined,
    enableSorting: enableSorting !== false,
    meta: { ...column.meta, ...meta },
  };
}

export function getColumnConfigs<TData extends RowData>(
  columns: readonly ColumnDef<DataTableFeatures, TData>[]
) {
  const configs: DataTableColumnConfigs = {};

  for (const column of getLeafColumns(columns)) {
    const columnId = getColumnId(column);
    if (!columnId) continue;
    configs[columnId] = getColumnConfig(column);
  }

  return configs;
}

export function getConfigInputKey<TData extends RowData>(
  columns: readonly ColumnDef<DataTableFeatures, TData>[],
  input: DataTableConfigInput = {}
) {
  return JSON.stringify({ ...input, columns: getColumnConfigs(columns) });
}

export function createConfigFromInputKey(key: string) {
  const options: DataTableConfigOptions<DataTableColumnConfigs> =
    JSON.parse(key);
  return createDataTableConfig(options);
}

export function getUnmatchedConfigIds<TData extends RowData>(
  configs: DataTableColumnConfigs,
  columns: readonly ColumnDef<DataTableFeatures, TData>[]
) {
  const columnIds = new Set(
    getLeafColumns(columns).map((column) => getColumnId(column))
  );
  return Object.keys(configs).filter((columnId) => !columnIds.has(columnId));
}

function getFilterVariants(columns: DataTableColumnConfigs) {
  return Object.fromEntries(
    Object.entries(columns).flatMap(([columnId, config]) =>
      config.variant ? [[columnId, config.variant] as const] : []
    )
  );
}

function getSortableIds<TColumns extends DataTableColumnConfigs>(
  columns: TColumns
) {
  // SAFETY: the filter keeps only the keys of `columns`, and a key whose
  // config does not say `enableSorting: false` is what `SortableColumnId`
  // describes.
  return Object.keys(columns).filter(
    (columnId) => columns[columnId]?.enableSorting !== false
  ) as SortableColumnId<TColumns>[];
}

function parseInteger(
  value: DataTableRawValue,
  fallback: number,
  min: number,
  max = Number.POSITIVE_INFINITY
) {
  const text = getSearchString(value);
  if (!isString(text)) return fallback;

  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return fallback;
  }
  return parsed;
}

function getJoinOperator(
  value: DataTableRawValue,
  fallback: JoinOperator
): JoinOperator {
  const operator = getSearchString(value);
  return JOIN_OPERATORS.find((item) => item === operator) ?? fallback;
}

function getKeys<TKey extends string>(record: Record<TKey, DataTableRawValue>) {
  // SAFETY: `Object.keys` returns exactly the string keys of the record, and
  // `TKey` is that record's own key type.
  return Object.keys(record) as TKey[];
}

function fromKeys<TKey extends string, TValue>(
  keys: readonly TKey[],
  getValue: (key: TKey) => TValue
) {
  // SAFETY: the entry list is built from `keys` itself, one entry per key, so
  // every key is present and its value came from `getValue`.
  return Object.fromEntries(keys.map((key) => [key, getValue(key)])) as Record<
    TKey,
    TValue
  >;
}

function getIsDataTableKey(key: string): key is DataTableKey {
  return DATA_TABLE_KEYS.some((item) => item === key);
}

function getLeafColumns<TData extends RowData>(
  columns: readonly ColumnDef<DataTableFeatures, TData>[]
): ColumnDef<DataTableFeatures, TData>[] {
  return columns.flatMap((column) =>
    getIsGroupColumn(column) ? getLeafColumns(column.columns) : [column]
  );
}

function getColumnConfig<TData extends RowData>(
  column: ColumnDef<DataTableFeatures, TData>
): DataTableColumnConfig {
  const hasAccessor = "accessorKey" in column || "accessorFn" in column;
  const enableSorting = hasAccessor && column.enableSorting !== false;
  if (!column.enableColumnFilter) return { enableSorting };

  return { enableSorting, variant: getFilterVariant(column.meta) };
}

function getIsGroupColumn<TData extends RowData>(
  column: ColumnDef<DataTableFeatures, TData>
): column is ColumnDef<DataTableFeatures, TData> & {
  columns: ColumnDef<DataTableFeatures, TData>[];
} {
  return "columns" in column && Array.isArray(column.columns);
}

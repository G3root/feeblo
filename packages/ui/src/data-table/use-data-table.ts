import { isNumber, isString } from "@feeblo/utils/runtime-kind";
import { useLocation, useNavigate } from "@tanstack/react-router";
import {
  type ColumnFiltersState,
  functionalUpdate,
  type PaginationState,
  type RowData,
  type SortingState,
  type TableOptions,
  type TableState,
  type Updater,
  useTable,
} from "@tanstack/react-table";
import * as React from "react";

import {
  applyColumnConfig,
  createConfigFromInputKey,
  type DataTableConfigInput,
  getConfigInputKey,
  getIsDataTableConfig,
  getUnmatchedConfigIds,
} from "./lib/data-table-config";
import {
  type DataTableFeatures,
  dataTableFeatures,
} from "./lib/data-table-features";
import {
  type DataTableSearchRecord,
  getSearchStrings,
} from "./lib/data-table-parsers";
import type {
  ColumnFilterItem,
  DataTableRawValue,
  JoinOperator,
} from "./lib/data-table-types";
import { getActiveFilters } from "./lib/data-table-utils";

const DEBOUNCE_MS = 300;

type InitialTableState = Partial<TableState<DataTableFeatures>>;

type UseDataTableProps<TData extends RowData> = Omit<
  TableOptions<DataTableFeatures, TData>,
  | "state"
  | "onPaginationChange"
  | "onSortingChange"
  | "onColumnFiltersChange"
  | "onGlobalFilterChange"
  | "onJoinOperatorChange"
  | "pageCount"
  | "features"
  | "initialState"
  | "enableGlobalFilter"
  | "pageSizeOptions"
  | "manualFiltering"
  | "manualPagination"
  | "autoResetPageIndex"
  | "manualSorting"
> & {
  /** How long typing in the global filter waits before the URL is written. */
  debounceMs?: number;
  /**
   * Whether a write replaces the current history entry. Matches the router's
   * own default of `false`, so filtering does not bury the previous page.
   */
  replace?: boolean;
  /** Ask the router to keep the scroll position across a table write. */
  resetScroll?: boolean;
  config?: DataTableConfigInput;
  initialState?: Omit<
    InitialTableState,
    "columnFilters" | "globalFilter" | "sorting" | "pagination" | "joinOperator"
  >;
} & (
    | {
        mode?: "server";
        pageCount: number;
      }
    | {
        mode: "client";
        pageCount?: never;
      }
  );

/**
 * TanStack Table state, held in the route's search params.
 *
 * This is the `nuqs` port: instead of nuqs' `useQueryStates`, the table reads
 * `location.search` through TanStack Router and writes it back with
 * `navigate`. Three consequences worth knowing:
 *
 * 1. It reads `location.search`, not `Route.useSearch()`, so the table works in
 *    any route and cannot be stripped by a route's `validateSearch` schema. A
 *    route that mounts a table does not have to declare its keys.
 * 2. A write merges into the record it read, so search params the table does
 *    not own (a `tab`, a `board`) survive a filter change.
 * 3. The state the table renders is optimistic: a write is reflected locally
 *    and the URL is written a debounce later, matching nuqs' `limitUrlUpdates`.
 *    Without it every keystroke of a global filter would push a navigation.
 */
function useDataTable<TData extends RowData>({
  config: configProp,
  columns,
  mode = "server",
  pageCount,
  initialState,
  debounceMs = DEBOUNCE_MS,
  replace = true,
  resetScroll = false,
  ...props
}: UseDataTableProps<TData>) {
  const isServer = mode === "server";
  const builtConfig = getIsDataTableConfig(configProp) ? configProp : undefined;
  const configInputKey = builtConfig
    ? ""
    : getConfigInputKey(columns, configProp);
  const config = React.useMemo(
    () => builtConfig ?? createConfigFromInputKey(configInputKey),
    [builtConfig, configInputKey]
  );
  const { enableGlobalFilter, pageSizeOptions, filterVariants } = config;

  const [initialTableState] = React.useState<InitialTableState>(() => ({
    ...initialState,
    sorting: config.defaultSorting,
    pagination: { pageIndex: 0, pageSize: config.defaultPageSize },
    joinOperator: config.defaultJoinOperator,
  }));

  const tableColumns = React.useMemo(
    () =>
      builtConfig
        ? columns.map((column) =>
            applyColumnConfig(column, builtConfig.columns)
          )
        : columns,
    [columns, builtConfig]
  );

  const hasInlineColumns =
    configProp !== undefined && !builtConfig && "columns" in configProp;

  React.useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    if (hasInlineColumns) {
      console.warn(
        "useDataTable: an inline config ignores `columns`. Pass the config through createDataTableConfig, or set the filter and sorting on the column defs."
      );
    }
    if (!builtConfig) return;
    const unmatchedIds = getUnmatchedConfigIds(builtConfig.columns, columns);
    if (unmatchedIds.length === 0) return;
    console.warn(
      `useDataTable: the config has no matching column for ${unmatchedIds.map((columnId) => `"${columnId}"`).join(", ")}. Rename the config key or add the column.`
    );
  }, [hasInlineColumns, builtConfig, columns]);

  const location = useLocation();
  // SAFETY: `location.search` is the router's `parseSearch` output, which is
  // exactly a record of strings, numbers, booleans and arrays of those.
  const locationSearch = location.search as DataTableSearchRecord;
  const locationSearchKey = getSearchKey(locationSearch);

  const [draft, setDraft] = React.useState<SearchDraft | null>(null);

  // Drop the optimistic copy once the router reflects it, or once the URL has
  // moved somewhere the write did not ask for (back/forward, a link).
  React.useEffect(() => {
    setDraft((current) => {
      if (!current) return current;
      if (getSearchKey(current.search) === locationSearchKey) return null;
      if (current.baseKey !== locationSearchKey) return null;
      return current;
    });
  }, [locationSearchKey]);

  const search = draft?.search ?? locationSearch;
  const query = config.parse(search);

  const navigate = useNavigate();
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef<DataTableSearchRecord | null>(null);

  const flush = React.useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const next = pendingRef.current;
    pendingRef.current = null;
    if (!next) return;

    void navigate({
      to: ".",
      search: next,
      replace,
      resetScroll,
    });
  }, [navigate, replace, resetScroll]);

  React.useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    []
  );

  const writeQuery = React.useCallback(
    (
      patch: Partial<typeof query>,
      { debounce }: { debounce: boolean } = { debounce: true }
    ) => {
      const nextSearch = config.apply(search, { ...query, ...patch });

      // A write that changes nothing must not push a history entry: a
      // controlled input that re-emits its current value would otherwise
      // navigate on every render.
      if (getSearchKey(nextSearch) === getSearchKey(search)) return;

      setDraft({ baseKey: getSearchKey(search), search: nextSearch });
      pendingRef.current = nextSearch;

      if (!debounce) {
        flush();
        return;
      }

      // Trailing edge: every keystroke pushes the write out, so the URL is
      // written once the typing stops rather than once per `debounceMs`.
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(flush, debounceMs);
    },
    [config, debounceMs, flush, query, search]
  );

  const pagination = React.useMemo<PaginationState>(
    () => ({ pageIndex: query.page - 1, pageSize: query.perPage }),
    [query.page, query.perPage]
  );

  const getNextPagination = useChainedUpdate(pagination);

  function onPaginationChange(updater: Updater<PaginationState>) {
    const next = getNextPagination(updater);
    if (
      next.pageIndex === pagination.pageIndex &&
      next.pageSize === pagination.pageSize
    ) {
      return;
    }

    writeQuery(
      { page: next.pageIndex + 1, perPage: next.pageSize },
      { debounce: false }
    );
  }

  const sorting = query.sorting;
  const getNextSorting = useChainedUpdate(sorting);

  function onSortingChange(updater: Updater<SortingState>) {
    const next = getNextSorting(updater);
    if (JSON.stringify(next) === JSON.stringify(sorting)) return;
    writeQuery({ sorting: next, page: 1 }, { debounce: false });
  }

  const joinOperator = query.joinOperator;
  const getNextJoinOperator = useChainedUpdate(joinOperator);

  function onJoinOperatorChange(updater: Updater<JoinOperator>) {
    const next = getNextJoinOperator(updater);
    if (next === joinOperator) return;
    writeQuery({ joinOperator: next, page: 1 }, { debounce: false });
  }

  const globalFilter = enableGlobalFilter ? query.globalFilter : "";
  const getNextGlobalFilter = useChainedUpdate<DataTableRawValue>(globalFilter);

  function onGlobalFilterChange(updater: Updater<DataTableRawValue>) {
    if (!enableGlobalFilter) return;
    const value = getGlobalFilterValue(getNextGlobalFilter(updater));
    if (value === globalFilter) return;

    writeQuery(
      { globalFilter: value, page: 1 },
      // Clearing a search is a single decisive action; typing is not.
      { debounce: isServer && value !== "" }
    );
  }

  const columnFilters = query.filters;
  const getNextColumnFilters = useChainedUpdate<ColumnFiltersState>(
    // SAFETY: every `ColumnFilterItem` is a `ColumnFilter`, which is all the
    // table's own `onColumnFiltersChange` needs to see.
    columnFilters as ColumnFiltersState
  );

  function onColumnFiltersChange(updater: Updater<ColumnFiltersState>) {
    const filters = getNextColumnFilters(updater);
    const activeFilters = getActiveFilters(asFilterItems(filters)).filter(
      (filter) => Object.hasOwn(filterVariants, filter.id)
    );

    writeQuery(
      { filters: activeFilters, page: 1 },
      { debounce: isServer && activeFilters.length >= columnFilters.length }
    );
  }

  const tableOptions: TableOptions<DataTableFeatures, TData> = {
    ...props,
    features: dataTableFeatures,
    columns: tableColumns,
    enableGlobalFilter,
    pageSizeOptions,
    initialState: initialTableState,
    state: {
      pagination,
      sorting,
      // SAFETY: the table only ever stores `ColumnFilterItem`s; every write
      // goes through `onColumnFiltersChange` below.
      columnFilters: columnFilters as ColumnFilterItem[],
      joinOperator,
      globalFilter,
    },
    onPaginationChange,
    onSortingChange,
    onColumnFiltersChange,
    onJoinOperatorChange,
    onGlobalFilterChange,
    manualPagination: isServer,
    autoResetPageIndex: false,
    manualSorting: isServer,
    manualFiltering: isServer,
  };

  // `pageCount` is a server-mode option only; assigning it conditionally keeps
  // the client-mode options object free of a `undefined` the table would read
  // as "unknown page count".
  if (isServer && pageCount !== undefined) tableOptions.pageCount = pageCount;

  const table = useTable(tableOptions, selectTableState);

  return { table };
}

interface SearchDraft {
  readonly search: DataTableSearchRecord;
  /** The URL the write was computed from, so an outside navigation wins. */
  readonly baseKey: string;
}

/**
 * A comparable spelling of a search record.
 *
 * Key order is not part of the URL's meaning, so it is not part of the key.
 * Repeated keys are kept apart: `?status=a&status=b` is not `?status=b&status=a`
 * to a filter, but `sort` and `search` are single-valued.
 */
function getSearchKey(search: DataTableSearchRecord): string {
  return Object.entries(search)
    .flatMap(([key, value]) =>
      getSearchStrings(value).map((item) => `${key}=${item}`)
    )
    .sort()
    .join("&");
}

function getGlobalFilterValue(value: DataTableRawValue) {
  if (isString(value)) return value;
  if (isNumber(value)) return String(value);
  return "";
}

function asFilterItems(filters: ColumnFiltersState): ColumnFilterItem[] {
  // SAFETY: the table's filter state only ever holds items this feature wrote
  // through `normalizeColumnFilter`.
  return filters as ColumnFilterItem[];
}

function selectTableState(state: TableState<DataTableFeatures>) {
  return {
    columnFilters: state.columnFilters,
    globalFilter: state.globalFilter,
    joinOperator: state.joinOperator,
    pagination: state.pagination,
    sorting: state.sorting,
  };
}

function useChainedUpdate<TValue>(value: TValue) {
  const pendingRef = React.useRef<{ base: TValue; next: TValue } | null>(null);

  return (updater: Updater<TValue>) => {
    const pending = pendingRef.current;
    const next = functionalUpdate(
      updater,
      pending?.base === value ? pending.next : value
    );
    pendingRef.current = { base: value, next };
    return next;
  };
}

export { useDataTable, type UseDataTableProps };

import {
  ArrowLeft01Icon,
  ArrowLeftDoubleIcon,
  ArrowRight01Icon,
  ArrowRightDoubleIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactTable, RowData } from "@tanstack/react-table";
import * as React from "react";

import { Button } from "../button";
import {
  Select,
  SelectGroup,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "../select";
import { cn } from "../utils";
import type { DataTableFeatures } from "./lib/data-table-features";
import {
  DEFAULT_PAGE_SIZE_OPTIONS,
  getVisibleSelectedRows,
} from "./lib/data-table-utils";

interface DataTablePaginationProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
}

export function DataTablePagination<TData extends RowData>({
  table,
  className,
  ...props
}: DataTablePaginationProps<TData>) {
  return (
    <table.Subscribe
      selector={(state) => ({
        pageIndex: state.pagination.pageIndex,
        pageSize: state.pagination.pageSize,
        selectedRowCount: table.getSelectedRowIds().length,
        visibleSelectedRowCount: getVisibleSelectedRows(table).length,
      })}
    >
      {({ pageIndex, pageSize, selectedRowCount, visibleSelectedRowCount }) => (
        <DataTablePaginationContent
          pageIndex={pageIndex}
          pageSize={pageSize}
          pageSizeOptions={
            table.options.pageSizeOptions ?? DEFAULT_PAGE_SIZE_OPTIONS
          }
          selectedRowCount={selectedRowCount}
          table={table}
          visibleSelectedRowCount={visibleSelectedRowCount}
          {...props}
          className={className}
        />
      )}
    </table.Subscribe>
  );
}

interface DataTablePaginationContentProps<
  TData extends RowData,
> extends React.ComponentProps<"div"> {
  table: ReactTable<DataTableFeatures, TData, unknown>;
  pageIndex: number;
  pageSize: number;
  selectedRowCount: number;
  visibleSelectedRowCount: number;
  pageSizeOptions: readonly number[];
}

function DataTablePaginationContent<TData extends RowData>({
  table,
  pageIndex,
  pageSize,
  selectedRowCount,
  visibleSelectedRowCount,
  pageSizeOptions,
  className,
  ...props
}: DataTablePaginationContentProps<TData>) {
  const pageSizeLabelId = React.useId();
  const sizeOptions = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].toSorted((a, b) => a - b);
  const items = sizeOptions.map((size) => ({
    label: String(size),
    value: String(size),
  }));
  const pageCount = table.getPageCount();
  const canPreviousPage = table.getCanPreviousPage();
  const canNextPage = table.getCanNextPage();

  return (
    <div
      className={cn(
        "flex w-full flex-col-reverse items-center justify-between gap-4 overflow-auto p-1 sm:flex-row sm:gap-8",
        className
      )}
      data-slot="data-table-pagination"
      {...props}
    >
      {selectedRowCount > 0 ? (
        <div
          className="text-muted-foreground flex-1 text-sm whitespace-nowrap"
          role="status"
        >
          {selectedRowCount.toLocaleString()}{" "}
          {selectedRowCount === 1 ? "row" : "rows"} selected
          {selectedRowCount > visibleSelectedRowCount
            ? ` (${(selectedRowCount - visibleSelectedRowCount).toLocaleString()} not shown)`
            : ""}
          .
        </div>
      ) : (
        // A table without a selection column has nothing to report, and an
        // empty "0 rows selected." is noise on every page.
        <div className="flex-1" />
      )}
      <div className="flex flex-col-reverse items-center gap-4 sm:flex-row sm:gap-6 lg:gap-8">
        <div className="flex items-center gap-2">
          <p
            className="text-sm font-medium whitespace-nowrap"
            id={pageSizeLabelId}
          >
            Rows per page
          </p>
          <Select
            items={items}
            onValueChange={(value) => {
              if (value == null) return;
              table.setPageSize(Number(value));
            }}
            value={String(pageSize)}
          >
            <SelectTrigger
              aria-labelledby={pageSizeLabelId}
              className="w-18"
              size="sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectPopup side="top">
              <SelectGroup>
                {items.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectPopup>
          </Select>
        </div>
        <div
          className="flex items-center justify-center text-sm font-medium"
          role="status"
        >
          Page {pageIndex + 1} of {pageCount}
        </div>
        <div className="flex items-center gap-2">
          <Button
            aria-label="Go to first page"
            className="hidden lg:flex"
            disabled={!canPreviousPage}
            onClick={() => table.setPageIndex(0)}
            size="icon"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon
              className="rtl:rotate-180"
              icon={ArrowLeftDoubleIcon}
            />
          </Button>
          <Button
            aria-label="Go to previous page"
            disabled={!canPreviousPage}
            onClick={() => table.previousPage()}
            size="icon"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon className="rtl:rotate-180" icon={ArrowLeft01Icon} />
          </Button>
          <Button
            aria-label="Go to next page"
            disabled={!canNextPage}
            onClick={() => table.nextPage()}
            size="icon"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon className="rtl:rotate-180" icon={ArrowRight01Icon} />
          </Button>
          <Button
            aria-label="Go to last page"
            className="hidden lg:flex"
            disabled={!canNextPage}
            onClick={() => table.setPageIndex(pageCount - 1)}
            size="icon"
            type="button"
            variant="outline"
          >
            <HugeiconsIcon
              className="rtl:rotate-180"
              icon={ArrowRightDoubleIcon}
            />
          </Button>
        </div>
      </div>
    </div>
  );
}

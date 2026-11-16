import { MoreHorizontalIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type {
  CellContext,
  ColumnDef,
  Row,
  RowData,
} from "@tanstack/react-table";
import type * as React from "react";

import { Button } from "../button";
import { Menu, MenuPopup, MenuTrigger } from "../menu";
import type { DataTableFeatures } from "./lib/data-table-features";

export interface GetDataTableActionsColumnOptions<
  TData extends RowData,
> extends Omit<
  Partial<ColumnDef<DataTableFeatures, TData>>,
  "id" | "header" | "cell"
> {
  actions: (context: CellContext<DataTableFeatures, TData>) => React.ReactNode;
  getAriaLabel?: (row: Row<DataTableFeatures, TData>) => string;
}

/**
 * A trailing column whose menu holds every row action.
 *
 * `actions` renders `Menu*` items, not arbitrary content: a menu popup owns
 * keyboard handling, and a plain `div` inside one would not be reachable.
 */
export function getDataTableActionsColumn<TData extends RowData>({
  actions,
  getAriaLabel = (row) => `Open actions for row ${row.getDisplayIndex() + 1}`,
  size = 48,
  enableHiding = false,
  enableSorting = false,
  ...props
}: GetDataTableActionsColumnOptions<TData>): ColumnDef<
  DataTableFeatures,
  TData
> {
  return {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: (context) => (
      <Menu>
        <MenuTrigger
          render={
            <Button
              aria-label={getAriaLabel(context.row)}
              className="text-muted-foreground data-popup-open:bg-accent"
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} />
            </Button>
          }
        />
        <MenuPopup align="end">{actions(context)}</MenuPopup>
      </Menu>
    ),
    size,
    enableHiding,
    enableSorting,
    ...props,
  };
}

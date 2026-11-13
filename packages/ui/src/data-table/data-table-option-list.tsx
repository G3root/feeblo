import { isNumber } from "@feeblo/utils/runtime-kind";
import { Search01Icon, Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import * as React from "react";

import { Checkbox } from "../checkbox";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
} from "../input-group";
import { cn } from "../utils";

export interface DataTableOption {
  label: string;
  value: string;
  count?: number;
  icon?: React.ComponentType<React.ComponentProps<"svg">>;
}

interface DataTableOptionListProps {
  items: readonly DataTableOption[];
  selectedValues: readonly string[];
  onToggle: (value: string) => void;
  /**
   * `true` renders a checkbox per row. `false` renders a single-choice list
   * and leaves closing the popup to the caller.
   */
  multiple?: boolean;
  searchPlaceholder?: string;
  emptyMessage?: string;
  className?: string;
}

/**
 * A searchable, checkboxed list — the body of every multi-select filter popup.
 *
 * A list of labelled checkboxes rather than a combobox: the popup shows what is
 * selected without a second interaction, and there is no second text field
 * competing with the one the popup already renders.
 */
export function DataTableOptionList({
  items,
  selectedValues,
  onToggle,
  multiple = true,
  searchPlaceholder = "Search…",
  emptyMessage = "No results found.",
  className,
}: DataTableOptionListProps) {
  const [search, setSearch] = React.useState("");
  const normalizedSearch = search.trim().toLowerCase();
  const visibleItems =
    normalizedSearch === ""
      ? items
      : items.filter((item) =>
          item.label.toLowerCase().includes(normalizedSearch)
        );

  return (
    <div className={cn("flex w-full flex-col gap-2", className)}>
      <InputGroup>
        <InputGroupInput
          aria-label={searchPlaceholder}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={searchPlaceholder}
          size="sm"
          value={search}
        />
        <InputGroupAddon>
          <InputGroupText>
            <HugeiconsIcon icon={Search01Icon} />
          </InputGroupText>
        </InputGroupAddon>
      </InputGroup>
      <ul className="max-h-64 overflow-y-auto overscroll-contain">
        {visibleItems.length === 0 ? (
          <li className="text-muted-foreground px-2 py-6 text-center text-sm">
            {emptyMessage}
          </li>
        ) : (
          visibleItems.map((item) => {
            const isSelected = selectedValues.includes(item.value);
            const Icon = item.icon;
            return (
              <li key={item.value}>
                <label
                  className={cn(
                    "hover:bg-accent flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm",
                    isSelected && "bg-accent/60"
                  )}
                >
                  {multiple ? (
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => onToggle(item.value)}
                    />
                  ) : (
                    <span className="flex size-4 shrink-0 items-center justify-center">
                      {isSelected ? <HugeiconsIcon icon={Tick02Icon} /> : null}
                    </span>
                  )}
                  {Icon ? (
                    <Icon aria-hidden="true" className="size-4 shrink-0" />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate" title={item.label}>
                    {item.label}
                  </span>
                  {isNumber(item.count) ? (
                    <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                      {item.count.toLocaleString()}
                    </span>
                  ) : null}
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

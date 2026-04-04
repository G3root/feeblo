import {
  Cancel01Icon,
  DashedLineCircleIcon,
  FilterMailIcon,
  Tag01Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { and, eq, useLiveSuspenseQuery } from "@tanstack/react-db";
import { useSelector } from "@xstate/store-react";
import { createContext, type ReactNode, useContext } from "react";
import { Button } from "~/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "~/components/ui/button-group";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { tagCollection } from "~/lib/collections";
import { cn } from "~/lib/utils";
import {
  BOARD_LANE_COLUMN_MAP,
  BOARD_LANE_COLUMNS,
  type BoardPostStatus,
} from "../../constants";
import {
  type BoardStatusOperator,
  type BoardTagOperator,
  useBoardStore,
} from "../../state/board-store-context";

type FilterTag = {
  id: string;
  name: string;
};

type BoardFilterContextValue = {
  clearAllFilters: () => void;
  clearStatusFilter: () => void;
  clearTagFilter: () => void;
  filters: ReturnType<typeof useBoardFilterState>;
  organizationId: string;
  setStatusOperator: (operator: BoardStatusOperator) => void;
  setTagOperator: (operator: BoardTagOperator) => void;
  tags: FilterTag[];
  toggleStatus: (status: BoardPostStatus) => void;
  toggleTag: (tagId: string) => void;
};

const BoardFilterContext = createContext<BoardFilterContextValue | null>(null);

const STATUS_OPERATOR_OPTIONS: Array<{
  label: string;
  value: BoardStatusOperator;
}> = [
  { label: "is any of", value: "isAnyOf" },
  { label: "is not", value: "isNot" },
];

const TAG_OPERATOR_OPTIONS: Array<{
  label: string;
  value: BoardTagOperator;
}> = [
  { label: "include all of", value: "includeAllOf" },
  { label: "include any of", value: "includeAnyOf" },
  { label: "exclude if any of", value: "excludeIfAnyOf" },
  { label: "exclude if all of", value: "excludeIfAllOf" },
];

function useBoardFilterState() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.activeView.filters);
}

function useBoardFilterContext() {
  const context = useContext(BoardFilterContext);

  if (!context) {
    throw new Error(
      "BoardFilter components must be used within BoardFilter.Root"
    );
  }

  return context;
}

function BoardFilterRoot({
  children,
  organizationId,
}: {
  children: ReactNode;
  organizationId: string;
}) {
  const store = useBoardStore();
  const filters = useBoardFilterState();
  const { data: tags } = useLiveSuspenseQuery(
    (q) => {
      return q
        .from({ tags: tagCollection })
        .where(({ tags }) =>
          and(
            eq(tags.organizationId, organizationId),
            eq(tags.type, "FEEDBACK")
          )
        )
        .select(({ tags }) => ({
          id: tags.id,
          name: tags.name,
        }));
    },
    [organizationId]
  );

  const clearStatusFilter = () => {
    store.send({ type: "setStatusOperator", operator: "isAnyOf" });
    for (const status of filters.statuses) {
      store.send({ type: "toggleStatusFilter", status });
    }
  };

  const clearTagFilter = () => {
    store.send({ type: "setTagOperator", operator: "includeAllOf" });
    for (const tagId of filters.tagIds) {
      store.send({ type: "toggleTagFilter", tagId });
    }
  };

  const value: BoardFilterContextValue = {
    clearAllFilters: () => {
      store.send({ type: "clearFilters" });
    },
    clearStatusFilter,
    clearTagFilter,
    filters,
    organizationId,
    setStatusOperator: (operator) => {
      store.send({ type: "setStatusOperator", operator });
    },
    setTagOperator: (operator) => {
      store.send({ type: "setTagOperator", operator });
    },
    tags,
    toggleStatus: (status) => {
      store.send({ type: "toggleStatusFilter", status });
    },
    toggleTag: (tagId) => {
      store.send({ type: "toggleTagFilter", tagId });
    },
  };

  return (
    <BoardFilterContext.Provider value={value}>
      {children}
    </BoardFilterContext.Provider>
  );
}

function BoardFilterTrigger() {
  const { filters, tags, toggleStatus, toggleTag } = useBoardFilterContext();
  const selectedStatuses = new Set(filters.statuses);
  const selectedTagIds = new Set(filters.tagIds);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button className="rounded-full" size="icon-sm" variant="outline">
            <HugeiconsIcon icon={FilterMailIcon} />
          </Button>
        }
      />
      <DropdownMenuContent className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <HugeiconsIcon icon={DashedLineCircleIcon} />
              Status
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                {BOARD_LANE_COLUMNS.map((status) => (
                  <DropdownMenuCheckboxItem
                    checked={selectedStatuses.has(status as BoardPostStatus)}
                    key={status}
                    onCheckedChange={() => {
                      toggleStatus(status as BoardPostStatus);
                    }}
                  >
                    {BOARD_LANE_COLUMN_MAP[status as BoardPostStatus]}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <HugeiconsIcon icon={Tag01Icon} />
              Labels
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent>
                {tags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    checked={selectedTagIds.has(tag.id)}
                    key={tag.id}
                    onCheckedChange={() => {
                      toggleTag(tag.id);
                    }}
                  >
                    {tag.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardFilterActiveRow() {
  const { clearAllFilters, filters, tags } = useBoardFilterContext();
  const hasStatusFilter = filters.statuses.length > 0;
  const hasTagFilter = filters.tagIds.length > 0;

  if (!(hasStatusFilter || hasTagFilter)) {
    return null;
  }

  const tagNameMap = new Map(tags.map((tag) => [tag.id, tag.name]));

  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {hasStatusFilter ? <BoardFilterStatusGroup /> : null}
        {hasTagFilter ? (
          <BoardFilterLabelsGroup tagNameMap={tagNameMap} />
        ) : null}
      </div>
      <Button onClick={clearAllFilters} size="sm" type="button" variant="ghost">
        Clear
      </Button>
    </div>
  );
}

function BoardFilterStatusGroup() {
  const { clearStatusFilter, filters, setStatusOperator, toggleStatus } =
    useBoardFilterContext();

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={DashedLineCircleIcon}>
        Status
      </BoardFilterReadonlySegment>
      <BoardFilterOperatorMenu
        options={STATUS_OPERATOR_OPTIONS}
        setValue={setStatusOperator}
        value={filters.statusOperator}
      />
      <BoardFilterValueMenu
        items={BOARD_LANE_COLUMNS.map((status) => ({
          checked: filters.statuses.includes(status as BoardPostStatus),
          key: status,
          label: BOARD_LANE_COLUMN_MAP[status as BoardPostStatus],
        }))}
        label={getStatusSummary(filters.statuses)}
        onToggle={(status) => {
          toggleStatus(status as BoardPostStatus);
        }}
      />
      <BoardFilterClearButton
        ariaLabel="Clear status filter"
        onClick={clearStatusFilter}
      />
    </BoardFilterActiveGroup>
  );
}

function BoardFilterLabelsGroup({
  tagNameMap,
}: {
  tagNameMap: Map<string, string>;
}) {
  const { clearTagFilter, filters, setTagOperator, tags, toggleTag } =
    useBoardFilterContext();

  return (
    <BoardFilterActiveGroup>
      <BoardFilterReadonlySegment icon={Tag01Icon}>
        Labels
      </BoardFilterReadonlySegment>
      <BoardFilterOperatorMenu
        options={TAG_OPERATOR_OPTIONS}
        setValue={setTagOperator}
        value={filters.tagOperator}
      />
      <BoardFilterValueMenu
        items={tags.map((tag) => ({
          checked: filters.tagIds.includes(tag.id),
          key: tag.id,
          label: tag.name,
        }))}
        label={getTagSummary(filters.tagIds, tagNameMap)}
        onToggle={toggleTag}
      />
      <BoardFilterClearButton
        ariaLabel="Clear labels filter"
        onClick={clearTagFilter}
      />
    </BoardFilterActiveGroup>
  );
}

function BoardFilterActiveGroup({ children }: { children: ReactNode }) {
  return (
    <ButtonGroup className="rounded-full bg-background/90">
      {children}
    </ButtonGroup>
  );
}

function BoardFilterReadonlySegment({
  children,
  icon,
}: {
  children: ReactNode;
  icon: typeof DashedLineCircleIcon;
}) {
  return (
    <ButtonGroupText className="rounded-full border-border bg-background px-3 text-foreground">
      <HugeiconsIcon className="text-muted-foreground" icon={icon} />
      {children}
    </ButtonGroupText>
  );
}

function BoardFilterOperatorMenu<T extends string>({
  options,
  setValue,
  value,
}: {
  options: Array<{ label: string; value: T }>;
  setValue: (value: T) => void;
  value: T;
}) {
  const activeLabel =
    options.find((option) => option.value === value)?.label ??
    options[0]?.label;

  return (
    <BoardFilterMenuSegment label={activeLabel ?? ""}>
      <DropdownMenuGroup>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            checked={option.value === value}
            key={option.value}
            onCheckedChange={(checked) => {
              if (checked) {
                setValue(option.value);
              }
            }}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuGroup>
    </BoardFilterMenuSegment>
  );
}

function BoardFilterValueMenu({
  items,
  label,
  onToggle,
}: {
  items: Array<{ checked: boolean; key: string; label: string }>;
  label: string;
  onToggle: (value: string) => void;
}) {
  return (
    <BoardFilterMenuSegment className="max-w-48" label={label}>
      <DropdownMenuGroup>
        {items.length === 0 ? (
          <DropdownMenuItem disabled>No options found</DropdownMenuItem>
        ) : (
          items.map((item) => (
            <DropdownMenuCheckboxItem
              checked={item.checked}
              key={item.key}
              onCheckedChange={() => {
                onToggle(item.key);
              }}
            >
              {item.label}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuGroup>
    </BoardFilterMenuSegment>
  );
}

function BoardFilterMenuSegment({
  children,
  className,
  label,
}: {
  children: ReactNode;
  className?: string;
  label: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            className={cn("max-w-48 rounded-full px-3 font-normal", className)}
            size="sm"
            variant="outline"
          >
            <span className="truncate">{label}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="w-56">
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BoardFilterClearButton({
  ariaLabel,
  onClick,
}: {
  ariaLabel: string;
  onClick: () => void;
}) {
  return (
    <Button
      aria-label={ariaLabel}
      className="rounded-full"
      onClick={onClick}
      size="icon-sm"
      type="button"
      variant="outline"
    >
      <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
    </Button>
  );
}

function getStatusSummary(statuses: BoardPostStatus[]) {
  if (statuses.length === 1) {
    return BOARD_LANE_COLUMN_MAP[statuses[0]];
  }

  return `${statuses.length} statuses`;
}

function getTagSummary(tagIds: string[], tagNameMap: Map<string, string>) {
  if (tagIds.length === 1) {
    return tagNameMap.get(tagIds[0]) ?? "1 label";
  }

  return `${tagIds.length} labels`;
}

export const BoardFilter = {
  ActiveGroup: BoardFilterActiveGroup,
  ActiveRow: BoardFilterActiveRow,
  ClearButton: BoardFilterClearButton,
  OperatorMenu: BoardFilterOperatorMenu,
  ReadonlySegment: BoardFilterReadonlySegment,
  Root: BoardFilterRoot,
  Trigger: BoardFilterTrigger,
  ValueMenu: BoardFilterValueMenu,
};

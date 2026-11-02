import { Button } from "@feeblo/ui/button";
import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { Popover, PopoverPopup, PopoverTrigger } from "@feeblo/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@feeblo/ui/toggle-group";
import {
  ArrowUpNarrowWideIcon,
  Sorting01Icon,
  GridViewIcon,
  ListViewIcon,
  Search01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useSelector } from "@xstate/store-react";

import {
  type BoardOrderField,
  useBoardOrdering,
  useBoardStore,
} from "../../state/board-store-context";
import { BoardFilter } from "./board-filter";
import { BoardViewTabs } from "./board-view-tabs";

const orderFieldOptions: ReadonlyArray<{
  label: string;
  value: BoardOrderField;
}> = [
  { label: "Created", value: "createdAt" },
  { label: "Updated", value: "updatedAt" },
  { label: "Upvotes", value: "upvoteCount" },
  { label: "Title", value: "title" },
];

export function BoardToolbar({
  boardId,
  boardSlug,
  organizationId,
  variant = "board",
}: {
  boardId?: string;
  boardSlug?: string;
  organizationId: string;
  variant?: "board" | "feedback";
}) {
  return (
    <BoardFilter.Root organizationId={organizationId}>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* One strip: the built-in presets and the member's own views are the
              same kind of thing (a way to look at this board), so they share a
              row and clip together instead of sitting on opposite sides of the
              search box. The strip is `flex-1` and measures itself. */}
          <BoardViewTabs
            boardId={boardId ?? null}
            boardSlug={boardSlug}
            organizationId={organizationId}
            variant={variant}
          />
          <div className="ml-auto flex w-full min-w-0 items-center justify-end gap-2 sm:w-auto">
            <div className="min-w-0 flex-1 sm:w-72 sm:flex-none">
              <BoardSearchInput />
            </div>
            <BoardFilter.Trigger />
            <DisplayPopOver />
          </div>
        </div>
        <BoardFilter.ActiveRow />
      </div>
    </BoardFilter.Root>
  );
}

function BoardSearchInput() {
  const store = useBoardStore();
  const search = useSelector(
    store,
    (state) => state.context.activeView.filters.search
  );

  return (
    <InputGroup>
      <InputGroupAddon>
        <InputGroupText>
          <HugeiconsIcon icon={Search01Icon} />
        </InputGroupText>
      </InputGroupAddon>
      <DebouncedInputGroupInput
        aria-label="Search feedback titles"
        onChange={(value) => {
          store.send({ type: "setSearch", value });
        }}
        placeholder="Search feedback titles"
        value={search}
      />
    </InputGroup>
  );
}

function DisplayPopOver() {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button className="rounded-full" size="icon-sm" variant="outline">
            <HugeiconsIcon icon={SlidersHorizontalIcon} />
          </Button>
        }
      />
      {/* `w-100` is 400px; clamp it so the popover cannot spill off a phone. */}
      <PopoverPopup className="w-[min(25rem,calc(100vw-2rem))]">
        <div className="flex flex-col gap-1">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-1">
            <span className="text-muted-foreground text-sm">View</span>
            <ViewSelect />
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-1">
            <span className="text-muted-foreground text-sm">Order by</span>
            <OrderingControls />
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function OrderingControls() {
  const store = useBoardStore();
  const ordering = useBoardOrdering();
  const isAscending = ordering.direction === "asc";
  // The trigger has no label element, so its accessible name would otherwise be
  // its content — just the selected value ("Created"). Prefixing the purpose
  // and keeping the value gives a screen reader both, because the trigger
  // exposes no separate closed-state value.
  const activeLabel =
    orderFieldOptions.find((option) => option.value === ordering.field)
      ?.label ?? "Created";

  return (
    <div className="flex items-center gap-1.5">
      <Button
        aria-label={
          isAscending
            ? "Change to descending order"
            : "Change to ascending order"
        }
        className="rounded-full"
        onClick={() => store.send({ type: "toggleOrderDirection" })}
        size="icon-sm"
        title={isAscending ? "Ascending" : "Descending"}
        variant="outline"
      >
        <HugeiconsIcon
          icon={isAscending ? ArrowUpNarrowWideIcon : Sorting01Icon}
        />
      </Button>
      <Select
        onValueChange={(value) => {
          if (!value) {
            return;
          }
          store.send({
            type: "setOrderField",
            // SAFETY: The select is populated only with BoardOrderField values.
            field: value as BoardOrderField,
          });
        }}
        value={ordering.field}
      >
        <SelectTrigger
          aria-label={`Order by: ${activeLabel}`}
          className="w-30"
          size="sm"
        >
          <SelectValue>
            {(value: string) =>
              orderFieldOptions.find((option) => option.value === value)
                ?.label ?? "Created"
            }
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="end">
          {orderFieldOptions.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}

function ViewSelect() {
  const store = useBoardStore();
  const mode = useSelector(store, (state) => state.context.displayMode);
  return (
    <ToggleGroup
      onValueChange={(value) => {
        store.send({
          type: "setDisplayMode",
          // SAFETY: The upstream source guarantees one of these values; the cast bridges an untyped API.
          mode: value?.[0] as "grid" | "list",
        });
      }}
      size="sm"
      value={[mode]}
      variant="outline"
    >
      <ToggleGroupItem aria-label="Toggle List view" value="list">
        <HugeiconsIcon icon={ListViewIcon} /> List
      </ToggleGroupItem>
      <ToggleGroupItem aria-label="Toggle Board view" value="grid">
        <HugeiconsIcon icon={GridViewIcon} /> Board
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

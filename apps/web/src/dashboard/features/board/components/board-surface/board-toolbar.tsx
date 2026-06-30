import { Button } from "@feeblo/ui/button";
import { DebouncedInputGroupInput } from "@feeblo/ui/debounced-input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupText,
} from "@feeblo/ui/input-group";
import { Popover, PopoverContent, PopoverTrigger } from "@feeblo/ui/popover";
import { toggleVariants } from "@feeblo/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "@feeblo/ui/toggle-group";
import {
  GridViewIcon,
  ListViewIcon,
  Search01Icon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { cn } from "@feeblo/ui/utils";
import { useBoardStore } from "../../state/board-store-context";
import { BoardFilter } from "./board-filter";

const links = [
  {
    name: "All feedbacks",
    to: "/$organizationId/board/$boardSlug" as const,
  },
  {
    name: "Active",
    to: "/$organizationId/board/$boardSlug/active" as const,
  },
  {
    name: "Backlog",
    to: "/$organizationId/board/$boardSlug/backlog" as const,
  },
];

const feedbackLinks = [
  {
    name: "All feedbacks",
    to: "/$organizationId/feedback" as const,
  },
  {
    name: "Active",
    to: "/$organizationId/feedback/active" as const,
  },
  {
    name: "Backlog",
    to: "/$organizationId/feedback/backlog" as const,
  },
];

export function BoardToolbar({
  boardSlug,
  organizationId,
  variant = "board",
}: {
  boardSlug?: string;
  organizationId: string;
  variant?: "board" | "feedback";
}) {
  return (
    <BoardFilter.Root organizationId={organizationId}>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            {variant === "feedback"
              ? feedbackLinks.map((link) => (
                  <Link
                    activeOptions={{
                      exact: true,
                    }}
                    activeProps={{
                      "data-active": "true",
                    }}
                    className={cn(
                      toggleVariants({
                        variant: "outline",
                        size: "sm",
                      }),
                      "h-7 min-w-7 data-active:bg-muted"
                    )}
                    key={link.to}
                    params={{ organizationId }}
                    to={link.to}
                  >
                    {link.name}
                  </Link>
                ))
              : links.map((link) => (
                  <Link
                    activeOptions={{
                      exact: true,
                    }}
                    activeProps={{
                      "data-active": "true",
                    }}
                    className={cn(
                      toggleVariants({
                        variant: "outline",
                        size: "sm",
                      }),
                      "h-7 min-w-7 data-active:bg-muted"
                    )}
                    key={link.to}
                    params={{ boardSlug: boardSlug ?? "", organizationId }}
                    to={link.to}
                  >
                    {link.name}
                  </Link>
                ))}
          </div>
          <div className="ml-auto flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
            <div className="w-full sm:w-72">
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
      <PopoverContent className="w-100">
        <div className="p-4">
          <ViewSelect />
        </div>
      </PopoverContent>
    </Popover>
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
          mode: value?.[0] as "grid" | "list",
        });
      }}
      size="sm"
      spacing={2}
      value={[mode]}
      variant="outline"
    >
      <ToggleGroupItem
        aria-label="Toggle List view"
        className="w-full"
        value="list"
      >
        <HugeiconsIcon icon={ListViewIcon} /> List
      </ToggleGroupItem>
      <ToggleGroupItem
        aria-label="Toggle Board view"
        className="w-full"
        value="grid"
      >
        <HugeiconsIcon icon={GridViewIcon} /> Board
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

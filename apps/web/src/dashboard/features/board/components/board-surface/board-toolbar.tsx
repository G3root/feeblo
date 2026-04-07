import {
  GridViewIcon,
  ListViewIcon,
  SlidersHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Link } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { Button } from "~/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "~/components/ui/popover";
import { toggleVariants } from "~/components/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
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

export function BoardToolbar({
  boardSlug,
  organizationId,
}: {
  boardSlug: string;
  organizationId: string;
}) {
  return (
    <BoardFilter.Root organizationId={organizationId}>
      <div className="flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {links.map((link) => (
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
                params={{ boardSlug, organizationId }}
                to={link.to}
              >
                {link.name}
              </Link>
            ))}
          </div>
          <div className="flex gap-2">
            <BoardFilter.Trigger />
            <DisplayPopOver />
          </div>
        </div>
        <BoardFilter.ActiveRow />
      </div>
    </BoardFilter.Root>
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

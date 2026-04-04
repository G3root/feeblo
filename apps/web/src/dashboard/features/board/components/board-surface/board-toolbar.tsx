import {
  FilterMailIcon,
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
import { useBoardStore } from "../../state/board-store-context";

export function BoardToolbar({
  boardSlug,
  organizationId,
}: {
  boardSlug: string;
  organizationId: string;
}) {
  return (
    <div className="flex items-center justify-between p-3">
      <div className="flex gap-2">
        <Link
          activeOptions={{
            exact: true,
          }}
          activeProps={{
            "data-active": "true",
          }}
          className={toggleVariants({
            variant: "outline",
            size: "sm",
            class: "data-active:bg-muted",
          })}
          params={{ boardSlug, organizationId }}
          to="/$organizationId/board/$boardSlug"
        >
          All feedbacks
        </Link>

        <Link
          activeOptions={{
            exact: true,
          }}
          activeProps={{
            "data-active": "true",
          }}
          className={toggleVariants({
            variant: "outline",
            size: "sm",
            class: "data-active:bg-muted",
          })}
          params={{ boardSlug, organizationId }}
          to="/$organizationId/board/$boardSlug/active"
        >
          Active
        </Link>
      </div>
      <div className="flex gap-2">
        <Button className="rounded-full" size="icon-sm" variant="outline">
          <HugeiconsIcon icon={FilterMailIcon} />
        </Button>
        <DisplayPopOver />
      </div>
    </div>
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

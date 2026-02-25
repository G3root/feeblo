import { GridViewIcon, ListViewIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Separator } from "~/components/ui/separator";
import { ToggleGroup, ToggleGroupItem } from "~/components/ui/toggle-group";
import {
  type BoardViewMode,
  useBoardViewMode,
  useBoardViewModeStore,
} from "../../state/view-mode-context";

export function BoardHeader({
  boardName,
  visibility,
}: {
  boardName: string;
  visibility: "PUBLIC" | "PRIVATE";
}) {
  return (
    <div className="border-border border-b px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="font-semibold text-lg tracking-tight">{boardName}</h2>
        <span className="rounded-md border border-border bg-muted px-2 py-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
          {visibility.toLowerCase()}
        </span>
      </div>
      <Separator className="my-3" />
      <div className="mt-3 flex items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5" />

        <div className="flex items-center gap-2">
          <BoardHeaderViewMode />
        </div>
      </div>
    </div>
  );
}

function BoardHeaderViewMode() {
  const mode = useBoardViewMode();
  const store = useBoardViewModeStore();
  return (
    <ToggleGroup
      aria-label="Board view mode"
      onValueChange={(value) => {
        const nextMode = value[0] as BoardViewMode | undefined;
        if (!nextMode) {
          return;
        }
        store.send({ type: "setMode", mode: nextMode });
      }}
      size="sm"
      value={[mode]}
    >
      <ToggleGroupItem aria-label="List view" value="list">
        <HugeiconsIcon icon={ListViewIcon} />
        List
      </ToggleGroupItem>
      <ToggleGroupItem aria-label="Grid view" value="grid">
        <HugeiconsIcon icon={GridViewIcon} />
        Grid
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

import { TablerIcon } from "@feeblo/ui/icon-picker";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { cn } from "@feeblo/ui/utils";
import { boardIconName } from "@feeblo/web-shared/icons/defaults";

import { useHome } from "../home-context";

export function HomeBoardSelect({ className }: { className?: string }) {
  const { state, actions } = useHome();
  const { boardItems, selectedBoard } = state;

  return (
    <Select
      items={boardItems}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          actions.updateFilters({ board: nextValue });
        }
      }}
      value={selectedBoard}
    >
      <SelectTrigger className={cn("min-w-0", className)}>
        <SelectValue>
          {(value: string) => {
            const item = boardItems.find(
              (candidate) => candidate.value === value
            );

            return item ? (
              <span className="flex items-center gap-2">
                {item.kind === "board" ? (
                  <TablerIcon name={boardIconName(item.icon)} />
                ) : null}
                {item.label}
              </span>
            ) : null;
          }}
        </SelectValue>
      </SelectTrigger>
      <SelectPopup>
        {boardItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            <span className="flex items-center gap-2">
              {item.kind === "board" ? (
                <TablerIcon name={boardIconName(item.icon)} />
              ) : null}
              {item.label}
            </span>
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

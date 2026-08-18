import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { cn } from "@feeblo/ui/utils";

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
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {boardItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";

import { useHome } from "../home-context";
import { getSortItems } from "./sort-options";

export function HomeSortSelect({ className }: { className?: string }) {
  const { state, actions } = useHome();
  const { sortBy } = state;
  const sortItems = getSortItems();

  return (
    <Select
      items={sortItems}
      onValueChange={(nextValue) => {
        if (nextValue !== null) {
          actions.updateFilters({ sort: nextValue });
        }
      }}
      value={sortBy}
    >
      <SelectTrigger className={className}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {sortItems.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

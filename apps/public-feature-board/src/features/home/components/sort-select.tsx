import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import { useHome } from "../home-context";
import { SORT_ITEMS } from "./sort-options";

export function HomeSortSelect({ className }: { className?: string }) {
  const { state, actions } = useHome();
  const { sortBy } = state;

  return (
    <Select
      items={SORT_ITEMS}
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
        {SORT_ITEMS.map((item) => (
          <SelectItem key={item.value} value={item.value}>
            {item.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

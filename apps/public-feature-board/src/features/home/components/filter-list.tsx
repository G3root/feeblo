import { cn } from "@feeblo/ui/utils";
import type { HomeFilterItem } from "../home-context";

export function HomeFilterList({
  items,
  onSelect,
  selectedValue,
  title,
}: {
  items: HomeFilterItem[];
  onSelect: (value: string) => void;
  selectedValue: string;
  title: string;
}) {
  return (
    <div className="space-y-2">
      <div className="px-1 font-medium text-sm">{title}</div>
      <div className="space-y-1">
        {items.map((item) => {
          const isActive = item.value === selectedValue;

          return (
            <button
              className={cn(
                "flex w-full items-center justify-between rounded-2xl px-3 py-2 text-left text-sm transition-colors",
                isActive
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              key={item.value}
              onClick={() => onSelect(item.value)}
              type="button"
            >
              <span className="truncate">{item.label}</span>
              <span className="text-xs tabular-nums">{item.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

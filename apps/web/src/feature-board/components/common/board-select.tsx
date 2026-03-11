import { startTransition } from "react";
import { cn } from "../../lib/utils";

export type BoardOption = {
  label: string;
  value: string;
};

export function BoardSelect({
  className,
  onChange,
  options,
  value,
}: {
  className?: string;
  onChange: (value: string) => void;
  options: BoardOption[];
  value: string;
}) {
  return (
    <label className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
        Board
      </span>
      <select
        className="h-9 min-w-52 rounded-lg border border-input bg-background px-3 text-sm shadow-xs outline-none transition focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        onChange={(event) => {
          const nextValue = event.currentTarget.value;

          startTransition(() => {
            onChange(nextValue);
          });
        }}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
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
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="text-muted-foreground text-xs uppercase tracking-wider">
        Board
      </span>
      <Select
        onValueChange={(v) => v !== null && onChange(v)}
        value={value}
      >
        <SelectTrigger className="min-w-52">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

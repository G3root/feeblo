import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import type { BoardPostStatus } from "~/features/board/constants";

const STATUS_DOT_COLORS: Record<BoardPostStatus, string> = {
  IN_PROGRESS: "#3b82f6",
  REVIEW: "#f59e0b",
  PLANNED: "#6b7280",
  COMPLETED: "#22c55e",
  PAUSED: "#eab308",
  CLOSED: "#ef4444",
};

const STATUS_LABELS: Record<BoardPostStatus, string> = {
  IN_PROGRESS: "In Progress",
  REVIEW: "In Review",
  PLANNED: "Planned",
  COMPLETED: "Completed",
  PAUSED: "Paused",
  CLOSED: "Closed",
};

export function PropertyRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="w-14 shrink-0 text-muted-foreground text-sm">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function StatusSelect({
  currentStatus,
  onValueChange,
}: {
  currentStatus: BoardPostStatus;
  onValueChange: (status: BoardPostStatus | null) => void;
}) {
  return (
    <Select onValueChange={onValueChange} value={currentStatus}>
      <SelectTrigger className="w-full">
        <SelectValue>
          <span
            className="size-2 shrink-0 rounded-full"
            style={{ backgroundColor: STATUS_DOT_COLORS[currentStatus] }}
          />
          {STATUS_LABELS[currentStatus]}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {Object.keys(STATUS_LABELS).map((status) => (
          <SelectItem key={status} value={status}>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{
                backgroundColor: STATUS_DOT_COLORS[status as BoardPostStatus],
              }}
            />
            {STATUS_LABELS[status as BoardPostStatus]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

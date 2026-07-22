import { Badge } from "@feeblo/ui/badge";
import {
  Select,
  SelectPopup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import {
  CHANGELOG_STATUS_LABELS,
  CHANGELOG_STATUSES,
  type ChangelogStatus,
} from "../constants";

const CHANGELOG_STATUS_STYLES: Record<ChangelogStatus, string> = {
  draft: "border-border bg-muted text-muted-foreground",
  scheduled: "border-amber-200 bg-amber-50 text-amber-700",
  published: "border-emerald-200 bg-emerald-50 text-emerald-700",
};

export function getChangelogStatusLabel(status: ChangelogStatus) {
  return CHANGELOG_STATUS_LABELS[status];
}

export function ChangelogStatusBadge({ status }: { status: ChangelogStatus }) {
  return (
    <Badge className={CHANGELOG_STATUS_STYLES[status]} variant="outline">
      {getChangelogStatusLabel(status)}
    </Badge>
  );
}

export function ChangelogStatusSelect({
  currentStatus,
  disabled = false,
  onValueChange,
}: {
  currentStatus: ChangelogStatus;
  disabled?: boolean;
  onValueChange: (value: ChangelogStatus) => void;
}) {
  return (
    <Select
      disabled={disabled}
      onValueChange={(value) => onValueChange(value as ChangelogStatus)}
      value={currentStatus}
    >
      <SelectTrigger className="w-full">
        <SelectValue placeholder="Select a status" />
      </SelectTrigger>
      <SelectPopup>
        {CHANGELOG_STATUSES.map((status) => (
          <SelectItem key={status} value={status}>
            {getChangelogStatusLabel(status)}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

import { Badge, type BadgeProps } from "@feeblo/ui/badge";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@feeblo/ui/select";
import {
  CHANGELOG_STATUS_LABELS,
  CHANGELOG_STATUSES,
  type ChangelogStatus,
} from "../constants";

const CHANGELOG_STATUS_STYLES: Record<ChangelogStatus, BadgeProps["variant"]> =
  {
    draft: "default",
    scheduled: "info",
    published: "success",
  };

export function getChangelogStatusLabel(status: ChangelogStatus) {
  return CHANGELOG_STATUS_LABELS[status];
}

export function ChangelogStatusBadge({ status }: { status: ChangelogStatus }) {
  return (
    <Badge variant={CHANGELOG_STATUS_STYLES[status]}>
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

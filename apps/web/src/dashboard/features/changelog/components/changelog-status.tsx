import { Badge, type BadgeProps } from "@feeblo/ui/badge";

import { CHANGELOG_STATUS_LABELS, type ChangelogStatus } from "../constants";

const CHANGELOG_STATUS_STYLES = {
  draft: "default",
  scheduled: "info",
  published: "success",
} satisfies Record<ChangelogStatus, BadgeProps["variant"]>;

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

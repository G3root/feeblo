import type { THelpCenterArticleState } from "@feeblo/domain-contracts/help-center-article";
import { Badge, type BadgeProps } from "@feeblo/ui/badge";

/**
 * The lifecycle labels, in one place.
 *
 * The editor's status picker and the list's badge both read these, so a status
 * cannot be called "Archived" on one surface and "Out of date" on another.
 */
const HELP_CENTER_ARTICLE_STATUS_LABELS = {
  archived: "Archived",
  draft: "Draft",
  published: "Published",
} satisfies Record<THelpCenterArticleState, string>;

const STATUS_STYLES = {
  archived: "outline",
  draft: "default",
  published: "success",
} satisfies Record<THelpCenterArticleState, BadgeProps["variant"]>;

export function HelpCenterArticleStatusBadge({
  status,
}: {
  status: THelpCenterArticleState;
}) {
  return (
    <Badge variant={STATUS_STYLES[status]}>
      {HELP_CENTER_ARTICLE_STATUS_LABELS[status]}
    </Badge>
  );
}

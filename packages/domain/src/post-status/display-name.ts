import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

/**
 * The human-readable name of a status.
 *
 * `post_status.label` is user-facing and may be empty until a workspace
 * customizes it, and a response with an empty status name is useless. The
 * dashboard and portal fall back to the same humanized type through
 * `@feeblo/web-shared/board/constants`, which this package cannot import
 * without inverting the dependency direction, so the rule is restated here —
 * once, for the status resource, the status embedded in a post payload, and
 * the status column of a CSV export.
 */
export const statusDisplayName = (
  label: string,
  type: TPostStatusType
): string => {
  const trimmed = label.trim();
  if (trimmed.length > 0) {
    return trimmed;
  }

  const [first = "", ...rest] = type.toLowerCase().split("_");
  const capitalized = first.charAt(0).toUpperCase() + first.slice(1);
  return [capitalized, ...rest].join(" ");
};

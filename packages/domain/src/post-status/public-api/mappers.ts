import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

import type { TPublicApiStatusDetail } from "./schema";

/**
 * What a status mapper is allowed to read.
 *
 * Declared structurally and narrowly on purpose: a mapper cannot accept the
 * dashboard row (which carries the workspace) and pass it through, and a column
 * added to the `post_status` table cannot reach a public response without being
 * added here first. `toStatusSource` is the only bridge from the repository row
 * to it.
 */
export type PublicApiStatusSource = {
  readonly id: string;
  readonly label: string;
  readonly type: TPostStatusType;
  readonly color: string | null;
  readonly orderIndex: number;
};

/** Narrows a repository row to the fields a public response may name. */
export const toStatusSource = (row: {
  readonly id: string;
  readonly label: string;
  readonly type: TPostStatusType;
  readonly color: string | null;
  readonly orderIndex: number;
}): PublicApiStatusSource => ({
  color: row.color,
  id: row.id,
  label: row.label,
  orderIndex: row.orderIndex,
  type: row.type,
});

/**
 * The human-readable name of a status.
 *
 * `post_status.label` is user-facing and may be empty until a workspace
 * customizes it, and an API response with an empty status name is useless. The
 * dashboard and portal fall back to the same humanized type through
 * `@feeblo/web-shared/board/constants`, which this package cannot import
 * without inverting the dependency direction, so the rule is restated here —
 * once, for both the status resource and the status embedded in a post payload.
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

/** One status as the status endpoint returns it. */
export const toPublicApiStatusDetail = (
  status: PublicApiStatusSource
): TPublicApiStatusDetail => ({
  color: status.color,
  id: status.id,
  name: statusDisplayName(status.label, status.type),
  orderIndex: status.orderIndex,
  type: status.type,
});

import type { TPostStatusType } from "@feeblo/domain-contracts/post-status-type";

import { statusDisplayName } from "../display-name";
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
 * customizes it, and an API response with an empty status name is useless.
 * The rule lives in `../display-name` so the post list, the status resource,
 * and the board CSV export all name a status the same way.
 */
export { statusDisplayName } from "../display-name";

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

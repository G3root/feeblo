import type { TPostStatusType } from "./post-status-type";

/**
 * The status type a new workspace's default status carries.
 *
 * `DEFAULT_POST_STATUSES` seeds a status of this type with `isDefault: true`,
 * so a workspace always has somewhere to file a post it was not told a status
 * for. It is a seed fact rather than a rule: once created, a workspace's
 * default is whatever row carries `isDefault`, which need not be a `PENDING`
 * status.
 */
export const DEFAULT_POST_STATUS_TYPE: TPostStatusType = "PENDING";

/**
 * The status a post lands in when the caller did not name one.
 *
 * Prefers the row marked `isDefault`, then the `PENDING` status, then the first
 * status in list order. The two fallbacks cover a row set with no default
 * marked — one predating the `is_default` backfill, or one whose default status
 * was cleared outside the app — and are what every caller did before this
 * helper existed (`statuses[0]`, or "the PENDING one"), so such a workspace
 * keeps behaving as it did instead of failing.
 *
 * Shared by every surface that files a post without a status: the widget, the
 * Slack and Discord integrations, and the create form the dashboard, the
 * public board and the widget all render.
 */
export const pickDefaultPostStatus = <
  Status extends { isDefault: boolean; type: TPostStatusType },
>(
  statuses: readonly Status[]
): Status | undefined =>
  statuses.find((status) => status.isDefault) ??
  statuses.find((status) => status.type === DEFAULT_POST_STATUS_TYPE) ??
  statuses[0];

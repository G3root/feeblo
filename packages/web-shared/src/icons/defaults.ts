import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import { isString } from "@feeblo/utils/runtime-kind";

/**
 * The icon a board, status or help-center topic renders when it has none.
 *
 * The default lives on the client rather than in the database so an existing
 * row can stay null and still draw something. The resolver only fills in a
 * null or empty value; it does not validate a name against the catalogue,
 * because the catalogue is code-split and not available synchronously.
 */
export const DEFAULT_BOARD_ICON = "layout-grid";

export const DEFAULT_HELP_CENTER_TOPIC_ICON = "lifebuoy";

/**
 * One default per built-in status type.
 *
 * A workspace may replace any of these with a picked icon; this map is what a
 * status created before the picker existed still shows, and what the status
 * form pre-selects for a new status in that section.
 */
export const DEFAULT_POST_STATUS_ICONS = {
  PENDING: "clock",
  REVIEW: "eye",
  PLANNED: "calendar-event",
  IN_PROGRESS: "circle-dot",
  COMPLETED: "circle-check",
  CLOSED: "circle-x",
} satisfies Record<TPostStatusType, string>;

const resolveIconName = (
  icon: string | null | undefined,
  fallback: string
): string => {
  if (!isString(icon)) {
    return fallback;
  }

  const trimmed = icon.trim();

  return trimmed.length > 0 ? trimmed : fallback;
};

export const boardIconName = (icon: string | null | undefined): string =>
  resolveIconName(icon, DEFAULT_BOARD_ICON);

export const helpCenterTopicIconName = (
  icon: string | null | undefined
): string => resolveIconName(icon, DEFAULT_HELP_CENTER_TOPIC_ICON);

export const postStatusIconName = (
  icon: string | null | undefined,
  type: TPostStatusType
): string => resolveIconName(icon, DEFAULT_POST_STATUS_ICONS[type]);

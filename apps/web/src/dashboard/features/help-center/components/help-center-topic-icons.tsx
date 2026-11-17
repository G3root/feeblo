import {
  BookOpen01Icon,
  Briefcase01Icon,
  Bug01Icon,
  CreditCardIcon,
  PuzzleIcon,
  RocketIcon,
  Settings01Icon,
  UserIcon,
} from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { HugeiconsIcon } from "@hugeicons/react";

/**
 * The topic icons the dashboard offers.
 *
 * A closed set rather than a free-text field, and stored as the key: the column
 * is a *name* the UI resolves, so changing the artwork later is a code change
 * and not a data migration, and an unknown stored value degrades to the
 * fallback instead of rendering nothing.
 */
export const HELP_CENTER_TOPIC_ICON_KEYS = [
  "book",
  "rocket",
  "settings",
  "card",
  "bug",
  "puzzle",
  "briefcase",
  "user",
] as const;

export type THelpCenterTopicIcon = (typeof HELP_CENTER_TOPIC_ICON_KEYS)[number];

// The `satisfies` is what makes adding a key to the list above a compile error
// until it has artwork, and what makes an artwork key that is not in the list a
// compile error too.
export const HELP_CENTER_TOPIC_ICONS = {
  book: BookOpen01Icon,
  rocket: RocketIcon,
  settings: Settings01Icon,
  card: CreditCardIcon,
  bug: Bug01Icon,
  puzzle: PuzzleIcon,
  briefcase: Briefcase01Icon,
  user: UserIcon,
} satisfies Record<THelpCenterTopicIcon, IconSvgElement>;

export const DEFAULT_HELP_CENTER_TOPIC_ICON: THelpCenterTopicIcon = "book";

/** True when `value` names an icon this build knows. */
export const isHelpCenterTopicIcon = (
  value: string | null | undefined
): value is THelpCenterTopicIcon =>
  value !== null && value !== undefined && isTopicIconKey(value);

/**
 * The membership test, widened once.
 *
 * `includes` on the readonly tuple wants a member of the union, and the whole
 * point of the guard is to accept a value that is not one yet — so the search
 * runs over the same keys as plain strings.
 */
const isTopicIconKey = (value: string): boolean =>
  HELP_CENTER_TOPIC_ICON_KEYS.some((key) => key === value);

export function HelpCenterTopicIcon({
  className,
  icon,
}: {
  className?: string;
  icon: string | null | undefined;
}) {
  const resolved = isHelpCenterTopicIcon(icon)
    ? icon
    : DEFAULT_HELP_CENTER_TOPIC_ICON;

  return (
    <HugeiconsIcon
      aria-hidden
      className={className}
      icon={HELP_CENTER_TOPIC_ICONS[resolved]}
    />
  );
}

import { TablerIcon } from "@feeblo/ui/icon-picker";
import { helpCenterTopicIconName } from "@feeblo/web-shared/icons/defaults";

/**
 * A section's icon.
 *
 * The column stores a Tabler name; a null or unknown value falls back to the
 * client's default, so a section created before the picker existed still has
 * a mark. The sprite is fetched by the first icon that renders, not by the
 * dialog, so a list of sections draws without opening the picker.
 */
export function HelpCenterTopicIcon({
  className,
  icon,
}: {
  className?: string;
  icon: string | null | undefined;
}) {
  return (
    <TablerIcon className={className} name={helpCenterTopicIconName(icon)} />
  );
}

import { TablerIcon } from "@feeblo/ui/icon-picker";
import type { BoardPostStatus } from "@feeblo/web-shared/board/constants";
import { postStatusIconName } from "@feeblo/web-shared/icons/defaults";

/**
 * A status mark from the icon picker.
 *
 * `icon` is the workspace's choice; a null or unknown name falls back to the
 * type's default so a status created before the picker existed still has a
 * mark. The colour is the caller's: a lane paints it with the status colour,
 * the settings page uses the status's own `color`, and a plain field uses the
 * neutral foreground.
 */
export function PostStatusIcon({
  className,
  icon,
  type,
}: {
  className?: string;
  icon?: string | null;
  type: BoardPostStatus;
}) {
  return (
    <TablerIcon className={className} name={postStatusIconName(icon, type)} />
  );
}

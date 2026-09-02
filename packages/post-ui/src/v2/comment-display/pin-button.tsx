import { MenuItem } from "@feeblo/ui/menu";
import { PinOffIcon, Pin02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentDisplay } from "./context";

export function PinButton() {
  const { actions, meta, state } = useCommentDisplay();
  const isPinned = state.pinnedAt != null;

  return (
    <MenuItem onClick={actions.onTogglePin}>
      <HugeiconsIcon icon={isPinned ? PinOffIcon : Pin02Icon} />
      {isPinned ? meta.unpinLabel : meta.pinLabel}
    </MenuItem>
  );
}

import { MenuItem } from "@feeblo/ui/menu";
import { Edit01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentDisplay } from "./context";

export function EditButton() {
  const { actions, meta } = useCommentDisplay();

  return (
    <MenuItem onClick={actions.onStartEdit}>
      <HugeiconsIcon icon={Edit01Icon} />
      {meta.editLabel}
    </MenuItem>
  );
}

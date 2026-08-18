import { MenuItem } from "@feeblo/ui/menu";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentDeleteDialogContext } from "../dialog-stores/comment";
import { useCommentDisplay } from "./context";

export function DeleteButton() {
  const store = useCommentDeleteDialogContext();
  const { meta, state } = useCommentDisplay();

  return (
    <MenuItem
      onClick={() =>
        store.send({
          type: "toggle",
          data: {
            commentId: state.commentId,
          },
        })
      }
    >
      <HugeiconsIcon icon={Delete02Icon} />
      {meta.deleteLabel}
    </MenuItem>
  );
}

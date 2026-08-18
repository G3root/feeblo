import { MenuItem } from "@feeblo/ui/menu";
import { EyeIcon, ViewOffIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useCommentVisibilityDialogContext } from "../dialog-stores/comment-visibility";
import { usePostCollectionData } from "../post-page-context";
import { useCommentDisplay } from "./context";

export function ToggleVisibilityButton() {
  const postData = usePostCollectionData();
  const store = useCommentVisibilityDialogContext();
  const { meta, state } = useCommentDisplay();

  if (!postData.isMember) {
    return null;
  }

  return (
    <MenuItem
      onClick={() =>
        store.send({
          type: "toggle",
          data: {
            commentId: state.commentId,
            isInternal: state.isInternal,
          },
        })
      }
    >
      <HugeiconsIcon icon={state.isInternal ? EyeIcon : ViewOffIcon} />
      {state.isInternal ? meta.toggleToPublicLabel : meta.toggleToInternalLabel}
    </MenuItem>
  );
}

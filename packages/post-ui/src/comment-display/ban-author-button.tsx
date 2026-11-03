import { MenuItem } from "@feeblo/ui/menu";
import { UserBlock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { useBanAuthorDialogContext } from "../dialog-stores/ban-author";
import { useCommentDisplay } from "./context";

/**
 * Opens the ban confirmation for this comment's author.
 *
 * The menu item only closes the menu, so the dialog lives at the page root
 * (`PostPage.Root`) and survives the popup unmounting.
 */
export function BanAuthorButton() {
  const store = useBanAuthorDialogContext();
  const { state } = useCommentDisplay();

  return (
    <MenuItem
      onClick={() =>
        store.send({
          type: "toggle",
          data: {
            authorName: state.authorName,
            target: { _tag: "comment", commentId: state.commentId },
          },
        })
      }
      variant="destructive"
    >
      <HugeiconsIcon icon={UserBlock01Icon} />
      Ban user
    </MenuItem>
  );
}

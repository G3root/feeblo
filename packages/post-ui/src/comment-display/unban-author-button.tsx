import { MenuItem } from "@feeblo/ui/menu";
import { toastManager } from "@feeblo/ui/toast";
import { parseRpcError } from "@feeblo/web-shared/rpc-error";
import { UserUnlock01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

import { usePostCollectionData } from "../post-page-context";
import { usePostCollections } from "../providers/post-collections-provider";
import { useCommentDisplay } from "./context";

/**
 * Lifts the ban on this comment's author.
 *
 * The ban is named by the comment, not by a ban id: the menu never sees one,
 * and the server resolves the author from a row this workspace owns. Unlike
 * banning, this is not destructive — the ban can be applied again — so it runs
 * without a confirmation, the same way the settings list does.
 *
 * The menu closes the moment the item is clicked, so the write is detached and
 * the toast reports the outcome.
 */
export function UnbanAuthorButton() {
  const { userBanActions } = usePostCollectionData();
  const {
    collections: { commentCollection, postCollection },
  } = usePostCollections();
  const { state } = useCommentDisplay();

  if (userBanActions === undefined) {
    return null;
  }

  const unban = async () => {
    try {
      await userBanActions.unban({
        target: { _tag: "comment", commentId: state.commentId },
      });
      toastManager.add({
        title: `Unbanned ${state.authorName}`,
        type: "success",
      });
      // The badge and the ban menu item both derive from these rows.
      await commentCollection.utils.refetch();
      await postCollection.utils.refetch();
    } catch (error) {
      toastManager.add({
        title: parseRpcError(error).message,
        type: "error",
      });
    }
  };

  return (
    <MenuItem
      onClick={() => {
        void unban();
      }}
    >
      <HugeiconsIcon icon={UserUnlock01Icon} />
      Unban user
    </MenuItem>
  );
}

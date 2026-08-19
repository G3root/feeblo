import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogPopup,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { useSelector } from "@xstate/store-react";

import { useCommentDeleteDialogContext } from "../dialog-stores/comment";
import { usePostCollections } from "../providers/post-collections-provider";

export function CommentDeleteDialog() {
  const store = useCommentDeleteDialogContext();
  const {
    collections: { commentCollection },
  } = usePostCollections();
  const open = useSelector(store, (state) => state.context.open);
  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Comment</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            comment.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={async () => {
              try {
                const id = store.get().context.data.commentId;
                const tx = commentCollection.delete(id);
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Comment deleted successfully",
                  type: "success",
                });
                store.send({ type: "toggle" });
              } catch {
                toastManager.add({
                  title: "Failed to delete comment",
                  type: "error",
                });
              }
            }}
            variant="destructive"
          >
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

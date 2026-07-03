import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
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
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Comment</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            comment.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                const id = store.get().context.data.commentId;
                store.send({ type: "toggle" });
                const tx = commentCollection.delete(id);
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Comment deleted successfully",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to delete comment",
                  type: "error",
                });
              }
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

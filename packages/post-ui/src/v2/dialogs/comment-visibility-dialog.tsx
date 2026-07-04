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
import { useCommentVisibilityDialogContext } from "../dialog-stores/comment-visibility";
import { usePostCollections } from "../providers/post-collections-provider";

export function CommentVisibilityDialog() {
  const store = useCommentVisibilityDialogContext();
  const {
    collections: { commentCollection },
  } = usePostCollections();
  const open = useSelector(store, (state) => state.context.open);
  const isInternal = useSelector(
    store,
    (state) => state.context.data.isInternal
  );

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {isInternal ? "Make comment public" : "Make comment internal"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {isInternal
              ? "This comment will be visible to everyone. Are you sure you want to make it public?"
              : "This comment will only be visible to members of your organization. Are you sure you want to make it internal?"}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                const { commentId, isInternal } = store.get().context.data;
                store.send({ type: "toggle" });
                const tx = commentCollection.update(commentId, (draft) => {
                  draft.visibility = isInternal ? "PUBLIC" : "INTERNAL";
                });
                await tx.isPersisted.promise;
                toastManager.add({
                  title: isInternal
                    ? "Comment is now public"
                    : "Comment is now internal",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to update comment visibility",
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

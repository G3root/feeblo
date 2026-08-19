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
      <AlertDialogPopup>
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
          <Button
            onClick={async () => {
              try {
                const { commentId, isInternal } = store.get().context.data;
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
                store.send({ type: "toggle" });
              } catch {
                toastManager.add({
                  title: "Failed to update comment visibility",
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

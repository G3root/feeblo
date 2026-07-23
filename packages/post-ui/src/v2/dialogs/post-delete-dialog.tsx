import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import { usePostDeleteDialogContext } from "../dialog-stores/post";
import { usePostCollections } from "../providers/post-collections-provider";

export function PostDeleteDialog() {
  const store = usePostDeleteDialogContext();
  const { collections } = usePostCollections();
  const open = useSelector(store, (state) => state.context.open);
  const navigate = useNavigate();
  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Post</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the post.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                const id = store.get().context.data.postId;
                const redirectOptions =
                  store.get().context.data.redirectOptions;

                const tx = collections.postCollection.delete(id, {
                  optimistic: false,
                });
                await tx.isPersisted.promise;
                trackEvent("post_deleted", { mode: "single", success: true });
                store.send({ type: "toggle" });
                toastManager.add({
                  title: "Post deleted successfully",
                  type: "success",
                });
                if (redirectOptions) {
                  navigate(redirectOptions);
                }
              } catch (_error) {
                trackEvent("post_deleted", { mode: "single", success: false });
                toastManager.add({
                  title: "Failed to delete post",
                  type: "error",
                });
              }
            }}
          >
            Continue
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

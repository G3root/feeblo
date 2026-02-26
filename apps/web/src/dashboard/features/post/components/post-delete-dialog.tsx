import { useNavigate } from "@tanstack/react-router";
import { useSelector } from "@xstate/store-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { toastManager } from "~/components/ui/toast";
import { postCollection } from "~/lib/collections";
import { usePostDeleteDialogContext } from "../dialog-stores";

export function PostDeleteDialog() {
  const store = usePostDeleteDialogContext();
  const open = useSelector(store, (state) => state.context.open);
  const navigate = useNavigate();
  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogContent>
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

                const tx = postCollection.delete(id, { optimistic: false });
                await tx.isPersisted.promise;
                store.send({ type: "toggle" });
                toastManager.add({
                  title: "Post deleted successfully",
                  type: "success",
                });
                if (redirectOptions) {
                  navigate(redirectOptions);
                }
              } catch (_error) {
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
      </AlertDialogContent>
    </AlertDialog>
  );
}

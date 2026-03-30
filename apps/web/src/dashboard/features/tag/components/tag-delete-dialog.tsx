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
import { tagCollection } from "~/lib/collections";
import { useTagDeleteDialogContext } from "../dialog-stores";

export function TagDeleteDialog() {
  const store = useTagDeleteDialogContext();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Tag</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the tag.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                const tagId = store.get().context.data.tagId;
                store.send({ type: "toggle" });
                const tx = tagCollection.delete(tagId);
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Tag deleted successfully",
                  type: "success",
                });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to delete tag",
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

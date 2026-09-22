import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { Button } from "@feeblo/ui/button";
import { toastManager } from "@feeblo/ui/toast";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { useSelector } from "@xstate/store-react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useTagDeleteDialogContext } from "../dialog-stores";

export function TagDeleteDialog() {
  const store = useTagDeleteDialogContext();
  const { tagCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Tag</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the tag.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={() => {
              const tagId = store.get().context.data.tagId;
              // The row is removed optimistically; close the confirm in the
              // same tick and settle persistence in the background.
              store.send({ type: "toggle" });
              settleOptimisticMutation(
                () => tagCollection.delete(tagId),
                () => {
                  toastManager.add({
                    title: "Tag deleted successfully",
                    type: "success",
                  });
                },
                () => {
                  toastManager.add({
                    title: "Failed to delete tag",
                    type: "error",
                  });
                }
              );
            }}
            type="button"
            variant="destructive"
          >
            Continue
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

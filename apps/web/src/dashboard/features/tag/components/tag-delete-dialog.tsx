import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
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
    <ConfirmDialog
      description="This action cannot be undone. This will permanently delete the tag."
      onConfirm={() => {
        const tagId = store.get().context.data.tagId;
        // The row is removed optimistically; close the confirm in the same
        // tick and settle persistence in the background.
        store.send({ type: "setOpen", open: false });
        settleOptimisticMutation(
          () => tagCollection.delete(tagId),
          () => {
            toastManager.add({
              title: "Tag deleted successfully",
              type: "success",
            });
          },
          () => {
            toastManager.add({ title: "Failed to delete tag", type: "error" });
          }
        );
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Delete Tag"
    />
  );
}

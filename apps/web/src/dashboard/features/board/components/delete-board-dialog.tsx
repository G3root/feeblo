import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { useSelector } from "@xstate/store-react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useDeleteBoardDialogContext } from "../dialog-stores";

export function DeleteBoardDialog() {
  const store = useDeleteBoardDialogContext();
  const { boardCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <ConfirmDialog
      description="This action cannot be undone. This will permanently delete the board."
      onConfirm={() => {
        const id = store.get().context.data.boardId;
        // The row is removed optimistically; close the confirm in the same
        // tick and settle persistence in the background.
        store.send({ type: "setOpen", open: false });
        settleOptimisticMutation(
          () => boardCollection.delete(id),
          () => {
            toastManager.add({
              title: "Board deleted successfully",
              type: "success",
            });
          },
          () => {
            toastManager.add({
              title: "Failed to delete board",
              type: "error",
            });
          }
        );
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Are you absolutely sure?"
    />
  );
}

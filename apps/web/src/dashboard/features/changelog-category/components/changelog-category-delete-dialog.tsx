import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { useSelector } from "@xstate/store-react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useChangelogCategoryDeleteDialogContext } from "../dialog-stores";

export function ChangelogCategoryDeleteDialog() {
  const store = useChangelogCategoryDeleteDialogContext();
  const { changelogCategoryCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <ConfirmDialog
      description="This action cannot be undone. Changelogs in this category will keep their content but no longer show the category."
      onConfirm={() => {
        const categoryId = store.get().context.data.categoryId;
        // The row is removed optimistically; close the confirm in the same
        // tick and settle persistence in the background.
        store.send({ type: "setOpen", open: false });
        settleOptimisticMutation(
          () => changelogCategoryCollection.delete(categoryId),
          () => {
            toastManager.add({
              title: "Category deleted successfully",
              type: "success",
            });
          },
          () => {
            toastManager.add({
              title: "Failed to delete category",
              type: "error",
            });
          }
        );
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Delete Category"
    />
  );
}

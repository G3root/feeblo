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
import { useSelector } from "@xstate/store-react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useChangelogCategoryDeleteDialogContext } from "../dialog-stores";

export function ChangelogCategoryDeleteDialog() {
  const store = useChangelogCategoryDeleteDialogContext();
  const { changelogCategoryCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete Category</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. Changelogs in this category will keep
            their content but no longer show the category.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={async () => {
              try {
                const categoryId = store.get().context.data.categoryId;
                const tx = changelogCategoryCollection.delete(categoryId);
                await tx.isPersisted.promise;
                toastManager.add({
                  title: "Category deleted successfully",
                  type: "success",
                });
                store.send({ type: "toggle" });
              } catch (_error) {
                toastManager.add({
                  title: "Failed to delete category",
                  type: "error",
                });
              }
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

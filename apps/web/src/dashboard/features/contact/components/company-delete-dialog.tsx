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
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { useSelector } from "@xstate/store-react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useCompanyDeleteDialogContext } from "../dialog-stores";

export function CompanyDeleteDialog() {
  const store = useCompanyDeleteDialogContext();
  const { companyCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <AlertDialog
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete company</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            company.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={() => {
              const companyId = store.get().context.data.companyId;
              // The row is removed optimistically; close the confirm in the
              // same tick and settle persistence in the background.
              store.send({ type: "toggle" });
              settleOptimisticMutation(
                () => companyCollection.delete(companyId),
                () => {
                  trackEvent("company_deleted", { success: true });
                  toastManager.add({
                    title: "Company deleted",
                    type: "success",
                  });
                },
                () => {
                  trackEvent("company_deleted", { success: false });
                  toastManager.add({
                    title: "Failed to delete company",
                    type: "error",
                  });
                }
              );
            }}
            variant="destructive"
          >
            Delete company
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogPopup,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { toastManager } from "@feeblo/ui/toast";
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
          <AlertDialogAction
            onClick={async () => {
              try {
                const companyId = store.get().context.data.companyId;
                const tx = companyCollection.delete(companyId);
                await tx.isPersisted.promise;
                store.send({ type: "toggle" });
                toastManager.add({ title: "Company deleted", type: "success" });
              } catch (_error) {
                toastManager.add({ title: "Failed to delete company", type: "error" });
              }
            }}
          >
            Delete company
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

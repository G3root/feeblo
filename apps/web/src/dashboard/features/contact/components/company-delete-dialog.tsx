import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
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
    <ConfirmDialog
      confirmLabel="Delete company"
      description="This action cannot be undone. This will permanently delete the company."
      onConfirm={() => {
        const companyId = store.get().context.data.companyId;
        // The row is removed optimistically; close the confirm in the same
        // tick and settle persistence in the background.
        store.send({ type: "setOpen", open: false });
        settleOptimisticMutation(
          () => companyCollection.delete(companyId),
          () => {
            trackEvent("company_deleted", { success: true });
            toastManager.add({ title: "Company deleted", type: "success" });
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
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Delete company"
    />
  );
}

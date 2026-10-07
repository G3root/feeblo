import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { settleOptimisticMutation } from "@feeblo/web-shared/collections";
import { useSelector } from "@xstate/store-react";

import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useContactDeleteDialogContext } from "../dialog-stores";

export function ContactDeleteDialog() {
  const store = useContactDeleteDialogContext();
  const { contactCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  return (
    <ConfirmDialog
      confirmLabel="Delete contact"
      description="This action cannot be undone. This will permanently delete the contact."
      onConfirm={() => {
        const contactId = store.get().context.data.contactId;
        // The row is removed optimistically; close the confirm in the same
        // tick and settle persistence in the background.
        store.send({ type: "setOpen", open: false });
        settleOptimisticMutation(
          () => contactCollection.delete(contactId),
          () => {
            trackEvent("contact_deleted", { success: true });
            toastManager.add({ title: "Contact deleted", type: "success" });
          },
          () => {
            trackEvent("contact_deleted", { success: false });
            toastManager.add({
              title: "Failed to delete contact",
              type: "error",
            });
          }
        );
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Delete contact"
    />
  );
}

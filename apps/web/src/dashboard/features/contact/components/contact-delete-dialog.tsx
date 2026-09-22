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

import { useContactDeleteDialogContext } from "../dialog-stores";

export function ContactDeleteDialog() {
  const store = useContactDeleteDialogContext();
  const { contactCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  const deleteContact = () => {
    const contactId = store.get().context.data.contactId;
    // The row is removed optimistically; close the confirm in the same tick
    // and settle persistence in the background.
    store.send({ type: "setOpen", open: false });
    settleOptimisticMutation(
      () => contactCollection.delete(contactId),
      () => {
        trackEvent("contact_deleted", { success: true });
        toastManager.add({ title: "Contact deleted", type: "success" });
      },
      () => {
        trackEvent("contact_deleted", { success: false });
        toastManager.add({ title: "Failed to delete contact", type: "error" });
      }
    );
  };

  return (
    <AlertDialog
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete contact</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. This will permanently delete the
            contact.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button onClick={deleteContact} variant="destructive">
            Delete contact
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

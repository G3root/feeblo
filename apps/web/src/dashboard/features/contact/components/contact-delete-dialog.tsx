import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useSelector } from "@xstate/store-react";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";
import { useContactDeleteDialogContext } from "../dialog-stores";

export function ContactDeleteDialog() {
  const store = useContactDeleteDialogContext();
  const { contactCollection } = useDashboardCollections();
  const open = useSelector(store, (state) => state.context.open);

  const deleteContact = async () => {
    try {
      const contactId = store.get().context.data.contactId;
      const tx = contactCollection.delete(contactId);
      await tx.isPersisted.promise;
      trackEvent("contact_deleted", { success: true });
      store.send({ type: "setOpen", open: false });
      toastManager.add({ title: "Contact deleted", type: "success" });
    } catch (_error) {
      trackEvent("contact_deleted", { success: false });
      toastManager.add({ title: "Failed to delete contact", type: "error" });
    }
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
          <AlertDialogAction onClick={deleteContact}>
            Delete contact
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

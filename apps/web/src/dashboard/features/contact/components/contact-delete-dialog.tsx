import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@feeblo/ui/alert-dialog";
import { toastManager } from "@feeblo/ui/toast";
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
      store.send({ type: "setOpen", open: false });
      toastManager.add({ title: "Contact deleted", type: "success" });
    } catch (_error) {
      toastManager.add({ title: "Failed to delete contact", type: "error" });
    }
  };

  return (
    <AlertDialog
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
    >
      <AlertDialogContent>
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
      </AlertDialogContent>
    </AlertDialog>
  );
}

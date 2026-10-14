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
  // The store's data is empty until the first open, so the id is guarded at
  // runtime even though the type says string.
  const contactId = store.get().context.data.contactId;
  const contact = contactId ? contactCollection.get(contactId) : undefined;

  return (
    <ConfirmDialog
      confirmLabel="Delete contact"
      description={
        <>
          <span className="block">
            This cannot be undone. The contact is removed from your workspace.
          </span>
          <span className="block">
            Their posts, votes, and comments stay attributed to them, and they
            are not unsubscribed from email updates.
          </span>
          {contact?.userId ? (
            <span className="block">
              This contact is linked to a Feeblo account. Deleting the contact
              does not change that account's access or email settings.
            </span>
          ) : null}
        </>
      }
      onConfirm={() => {
        // The row is removed optimistically; close the confirm in the same
        // tick and settle persistence in the background.
        store.send({ type: "setOpen", open: false });
        settleOptimisticMutation(
          () => contactCollection.delete(contactId),
          () => {
            trackEvent("contact_deleted", { success: true });
            toastManager.add({
              title: "Contact deleted",
              // Deletion is a CRM change, not a retraction of what the person
              // wrote; the copy says so at the moment it matters.
              description:
                "Their attributed posts, votes, and comments are unchanged.",
              type: "success",
            });
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

import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { parseRpcError, RpcError } from "@feeblo/web-shared/rpc-error";
import { fetchRpc } from "@feeblo/web-shared/runtime";
import { useSelector } from "@xstate/store-react";

import { useOrganizationId } from "~/hooks/use-organization-id";
import { useDashboardCollections } from "~/providers/dashboard-collections-provider";

import { useContactUnsubscribeDialogContext } from "../dialog-stores";

/**
 * Withdraws email consent for one customer.
 *
 * Separate from deleting them on purpose (see the copy): a workspace removes a
 * customer from the CRM for many reasons, and only some of them mean "stop
 * mailing this address". The RPC leaves the contact row alone and moves every
 * subscription the address holds to `unsubscribed`.
 */
export function ContactUnsubscribeDialog() {
  const store = useContactUnsubscribeDialogContext();
  const { contactCollection } = useDashboardCollections();
  const organizationId = useOrganizationId();
  const open = useSelector(store, (state) => state.context.open);
  const contactId = store.get().context.data.contactId;
  const contact = contactId ? contactCollection.get(contactId) : undefined;

  return (
    <ConfirmDialog
      confirmLabel="Stop email updates"
      description={
        <>
          <span className="block">
            This person stops receiving email updates from this workspace. The
            change takes effect for every post they are subscribed to.
          </span>
          <span className="block">
            Their posts, votes, and comments are unchanged, and the contact
            stays in your CRM.
          </span>
        </>
      }
      onConfirm={() => {
        store.send({ type: "setOpen", open: false });
        void fetchRpc((rpc) =>
          rpc.ContactUnsubscribe({ id: contactId, organizationId })
        ).then(
          () => {
            trackEvent("contact_unsubscribed", { success: true });
            toastManager.add({
              title: "Email updates stopped",
              description: contact?.email
                ? `${contact.email} no longer receives updates from this workspace.`
                : undefined,
              type: "success",
            });
          },
          (error: RpcError | Error) => {
            trackEvent("contact_unsubscribed", { success: false });
            toastManager.add({
              title: parseRpcError(error).message,
              type: "error",
            });
          }
        );
      }}
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Stop email updates"
    />
  );
}

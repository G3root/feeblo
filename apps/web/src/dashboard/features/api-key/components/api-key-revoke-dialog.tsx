import { useAtomSet } from "@effect/atom-react";
import { ConfirmDialog } from "@feeblo/ui/confirm-dialog";
import { toastManager } from "@feeblo/ui/toast";
import { trackEvent } from "@feeblo/web-shared/analytics-provider";
import { useSelector } from "@xstate/store-react";
import { useState } from "react";

import { useOrganizationId } from "~/hooks/use-organization-id";

import { apiKeyReactivityKeys, revokeApiKeyAtom } from "../atoms";
import { useApiKeyRevokeDialogContext } from "../dialog-stores";

/**
 * Revocation is confirmed rather than optimistic: the request may fail, and an
 * integration that stops authenticating is not something a UI should imply
 * before the server agrees.
 */
export function ApiKeyRevokeDialog() {
  const store = useApiKeyRevokeDialogContext();
  const organizationId = useOrganizationId();
  const open = useSelector(store, (state) => state.context.open);
  const keyName = useSelector(store, (state) => state.context.data.keyName);
  const revokeApiKey = useAtomSet(revokeApiKeyAtom, { mode: "promise" });
  const [isRevoking, setIsRevoking] = useState(false);

  return (
    <ConfirmDialog
      confirmLabel="Revoke key"
      confirmLoading={isRevoking}
      description={`Requests using ${keyName} start failing immediately. This cannot be undone, and any integration using the key needs a new one.`}
      onConfirm={async () => {
        const { keyId } = store.get().context.data;
        setIsRevoking(true);
        try {
          await revokeApiKey({
            payload: { keyId, organizationId },
            reactivityKeys: apiKeyReactivityKeys(organizationId),
          });
          trackEvent("api_key_revoked", { success: true });
          store.send({ type: "setOpen", open: false });
          toastManager.add({ title: "API key revoked", type: "success" });
        } catch {
          trackEvent("api_key_revoked", { success: false });
          toastManager.add({
            title: "Could not revoke API key",
            type: "error",
          });
        } finally {
          setIsRevoking(false);
        }
      }}
      // Set open: closing keeps the key the dialog was opened with, and the
      // requested state is respected rather than toggled.
      onOpenChange={(open) => store.send({ type: "setOpen", open })}
      open={open}
      title="Revoke API key"
    />
  );
}

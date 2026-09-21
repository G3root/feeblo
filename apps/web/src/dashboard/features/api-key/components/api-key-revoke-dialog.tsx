import { useAtomSet } from "@effect/atom-react";
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
import { useSelector } from "@xstate/store-react";

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

  return (
    <AlertDialog
      // Toggle: closing keeps the key the dialog was opened with, so the
      // confirmation copy never blanks out mid-transition.
      onOpenChange={() => store.send({ type: "toggle" })}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>Revoke API key</AlertDialogTitle>
          <AlertDialogDescription>
            Requests using {keyName} start failing immediately. This cannot be
            undone, and any integration using the key needs a new one.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            onClick={async () => {
              const { keyId } = store.get().context.data;
              try {
                await revokeApiKey({
                  payload: { keyId, organizationId },
                  reactivityKeys: apiKeyReactivityKeys(organizationId),
                });
                trackEvent("api_key_revoked", { success: true });
                store.send({ type: "toggle" });
                toastManager.add({ title: "API key revoked", type: "success" });
              } catch {
                trackEvent("api_key_revoked", { success: false });
                toastManager.add({
                  title: "Could not revoke API key",
                  type: "error",
                });
              }
            }}
            variant="destructive"
          >
            Revoke key
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

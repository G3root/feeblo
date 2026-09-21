import { createModalStoreContext } from "~/lib/xstate";

export const [ApiKeyCreateDialogProvider, useApiKeyCreateDialogContext] =
  createModalStoreContext<Record<string, never>>({
    name: "ApiKeyCreateDialogContext",
    hookName: "useApiKeyCreateDialogContext",
    providerName: "ApiKeyCreateDialogProvider",
  });

/** Carries the key being revoked so the confirmation can name it. */
export const [ApiKeyRevokeDialogProvider, useApiKeyRevokeDialogContext] =
  createModalStoreContext<{ keyId: string; keyName: string }>({
    name: "ApiKeyRevokeDialogContext",
    hookName: "useApiKeyRevokeDialogContext",
    providerName: "ApiKeyRevokeDialogProvider",
  });

import { createModalStoreContext } from "@feeblo/web-shared/xstate";

export const [UpgradePlanDialogProvider, useUpgradePlanDialogContext] =
  createModalStoreContext({
    name: "UpgradePlanDialogContext",
    hookName: "useUpgradePlanDialogContext",
    providerName: "UpgradePlanDialogProvider",
  });

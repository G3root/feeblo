import { createModalStoreContext } from "~/lib/xstate";

export const [UpgradePlanDialogProvider, useUpgradePlanDialogContext] =
  createModalStoreContext({
    name: "UpgradePlanDialogContext",
    hookName: "useUpgradePlanDialogContext",
    providerName: "UpgradePlanDialogProvider",
  });

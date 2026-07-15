import { createModalStoreContext } from "~/lib/xstate";

export type CustomAttributeEntityType = "contact" | "company";

export const [
  CustomAttributeCreateDialogProvider,
  useCustomAttributeCreateDialogContext,
] = createModalStoreContext<{ entityType: CustomAttributeEntityType }>({
  name: "CustomAttributeCreateDialogContext",
  hookName: "useCustomAttributeCreateDialogContext",
  providerName: "CustomAttributeCreateDialogProvider",
});

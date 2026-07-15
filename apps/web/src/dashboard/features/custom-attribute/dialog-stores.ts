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

export const [
  CustomAttributeEditDialogProvider,
  useCustomAttributeEditDialogContext,
] = createModalStoreContext<{
  attributeId: string;
  entityType: CustomAttributeEntityType;
}>({
  name: "CustomAttributeEditDialogContext",
  hookName: "useCustomAttributeEditDialogContext",
  providerName: "CustomAttributeEditDialogProvider",
});

export const [
  CustomAttributeDeleteDialogProvider,
  useCustomAttributeDeleteDialogContext,
] = createModalStoreContext<{
  attributeId: string;
  entityType: CustomAttributeEntityType;
}>({
  name: "CustomAttributeDeleteDialogContext",
  hookName: "useCustomAttributeDeleteDialogContext",
  providerName: "CustomAttributeDeleteDialogProvider",
});

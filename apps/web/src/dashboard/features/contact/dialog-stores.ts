import { createModalStoreContext } from "~/lib/xstate";

export const [ContactCreateDialogProvider, useContactCreateDialogContext] =
  createModalStoreContext({
    name: "ContactCreateDialogContext",
    hookName: "useContactCreateDialogContext",
    providerName: "ContactCreateDialogProvider",
  });

export const [CompanyCreateDialogProvider, useCompanyCreateDialogContext] =
  createModalStoreContext({
    name: "CompanyCreateDialogContext",
    hookName: "useCompanyCreateDialogContext",
    providerName: "CompanyCreateDialogProvider",
  });

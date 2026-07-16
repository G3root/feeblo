import { createModalStoreContext } from "~/lib/xstate";

export const [ContactCreateDialogProvider, useContactCreateDialogContext] =
  createModalStoreContext({
    name: "ContactCreateDialogContext",
    hookName: "useContactCreateDialogContext",
    providerName: "ContactCreateDialogProvider",
  });

export const [ContactEditDialogProvider, useContactEditDialogContext] =
  createModalStoreContext<{ contactId: string }>({
    name: "ContactEditDialogContext",
    hookName: "useContactEditDialogContext",
    providerName: "ContactEditDialogProvider",
  });

export const [ContactDeleteDialogProvider, useContactDeleteDialogContext] =
  createModalStoreContext<{ contactId: string }>({
    name: "ContactDeleteDialogContext",
    hookName: "useContactDeleteDialogContext",
    providerName: "ContactDeleteDialogProvider",
  });

export const [CompanyCreateDialogProvider, useCompanyCreateDialogContext] =
  createModalStoreContext({
    name: "CompanyCreateDialogContext",
    hookName: "useCompanyCreateDialogContext",
    providerName: "CompanyCreateDialogProvider",
  });

export const [CompanyEditDialogProvider, useCompanyEditDialogContext] =
  createModalStoreContext<{
    companyId: string;
    mode?: "display" | "edit";
  }>({
    name: "CompanyEditDialogContext",
    hookName: "useCompanyEditDialogContext",
    providerName: "CompanyEditDialogProvider",
  });

export const [CompanyDeleteDialogProvider, useCompanyDeleteDialogContext] =
  createModalStoreContext<{ companyId: string }>({
    name: "CompanyDeleteDialogContext",
    hookName: "useCompanyDeleteDialogContext",
    providerName: "CompanyDeleteDialogProvider",
  });

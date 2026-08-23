import { createModalStoreContext } from "~/lib/xstate";

export const [TagDeleteDialogProvider, useTagDeleteDialogContext] =
  createModalStoreContext<{ tagId: string }>({
    name: "TagDeleteDialogContext",
    hookName: "useTagDeleteDialogContext",
    providerName: "TagDeleteDialogProvider",
  });

export const [TagCreateDialogProvider, useTagCreateDialogContext] =
  createModalStoreContext<Record<string, never>>({
    name: "TagCreateDialogContext",
    hookName: "useTagCreateDialogContext",
    providerName: "TagCreateDialogProvider",
  });

export const [TagEditDialogProvider, useTagEditDialogContext] =
  createModalStoreContext<{ tagId: string }>({
    name: "TagEditDialogContext",
    hookName: "useTagEditDialogContext",
    providerName: "TagEditDialogProvider",
  });

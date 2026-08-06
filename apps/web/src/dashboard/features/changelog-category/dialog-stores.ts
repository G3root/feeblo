import { createModalStoreContext } from "~/lib/xstate";

export const [
  ChangelogCategoryDeleteDialogProvider,
  useChangelogCategoryDeleteDialogContext,
] = createModalStoreContext<{ categoryId: string }>({
  name: "ChangelogCategoryDeleteDialogContext",
  hookName: "useChangelogCategoryDeleteDialogContext",
  providerName: "ChangelogCategoryDeleteDialogProvider",
});

export const [
  ChangelogCategoryCreateDialogProvider,
  useChangelogCategoryCreateDialogContext,
] = createModalStoreContext<Record<string, never>>({
  name: "ChangelogCategoryCreateDialogContext",
  hookName: "useChangelogCategoryCreateDialogContext",
  providerName: "ChangelogCategoryCreateDialogProvider",
});

export const [
  ChangelogCategoryEditDialogProvider,
  useChangelogCategoryEditDialogContext,
] = createModalStoreContext<{ categoryId: string }>({
  name: "ChangelogCategoryEditDialogContext",
  hookName: "useChangelogCategoryEditDialogContext",
  providerName: "ChangelogCategoryEditDialogProvider",
});

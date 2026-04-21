import { createModalStoreContext } from "~/lib/xstate";

export const [
  ChangelogDeleteDialogProvider,
  useChangelogDeleteDialogContext,
] = createModalStoreContext<{ changelogId: string }>({
  name: "ChangelogDeleteDialogContext",
  hookName: "useChangelogDeleteDialogContext",
  providerName: "ChangelogDeleteDialogProvider",
});

export const [
  ChangelogMoveToDraftDialogProvider,
  useChangelogMoveToDraftDialogContext,
] = createModalStoreContext<{ changelogId: string }>({
  name: "ChangelogMoveToDraftDialogContext",
  hookName: "useChangelogMoveToDraftDialogContext",
  providerName: "ChangelogMoveToDraftDialogProvider",
});

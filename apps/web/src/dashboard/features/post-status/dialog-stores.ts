import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import { createModalStoreContext } from "@feeblo/web-shared/xstate";

/** The section whose "New" button opened the dialog; the new status joins it. */
export const [
  PostStatusCreateDialogProvider,
  usePostStatusCreateDialogContext,
] = createModalStoreContext<{ type: TPostStatusType }>({
  name: "PostStatusCreateDialogContext",
  hookName: "usePostStatusCreateDialogContext",
  providerName: "PostStatusCreateDialogProvider",
});

export const [PostStatusEditDialogProvider, usePostStatusEditDialogContext] =
  createModalStoreContext<{ statusId: string }>({
    name: "PostStatusEditDialogContext",
    hookName: "usePostStatusEditDialogContext",
    providerName: "PostStatusEditDialogProvider",
  });

export const [
  PostStatusDeleteDialogProvider,
  usePostStatusDeleteDialogContext,
] = createModalStoreContext<{ statusId: string }>({
  name: "PostStatusDeleteDialogContext",
  hookName: "usePostStatusDeleteDialogContext",
  providerName: "PostStatusDeleteDialogProvider",
});

import { createModalStoreContext } from "@feeblo/web-shared/xstate";

export const [
  CommentVisibilityDialogProvider,
  useCommentVisibilityDialogContext,
] = createModalStoreContext<{ commentId: string; isInternal: boolean }>({
  name: "CommentVisibilityDialogContext",
  hookName: "useCommentVisibilityDialogContext",
  providerName: "CommentVisibilityDialogProvider",
});

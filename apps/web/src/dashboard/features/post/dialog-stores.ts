import { createModalStoreContext } from "~/utils/model-context";

export const [CommentDeleteDialogProvider, useCommentDeleteDialogContext] =
  createModalStoreContext<{ commentId: string }>({
    name: "CommentDeleteDialogContext",
    hookName: "useCommentDeleteDialogContext",
    providerName: "CommentDeleteDialogProvider",
  });

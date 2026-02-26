import type { NavigateOptions } from "@tanstack/react-router";
import { createModalStoreContext } from "~/utils/model-context";

export const [CommentDeleteDialogProvider, useCommentDeleteDialogContext] =
  createModalStoreContext<{ commentId: string }>({
    name: "CommentDeleteDialogContext",
    hookName: "useCommentDeleteDialogContext",
    providerName: "CommentDeleteDialogProvider",
  });

export const [PostDeleteDialogProvider, usePostDeleteDialogContext] =
  createModalStoreContext<{
    postId: string;
    redirectOptions?: NavigateOptions;
  }>({
    name: "PostDeleteDialogContext",
    hookName: "usePostDeleteDialogContext",
    providerName: "PostDeleteDialogProvider",
  });

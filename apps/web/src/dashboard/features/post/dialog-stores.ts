import type { TPostStatus } from "@feeblo/db/schema/feedback";
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

export const [PostCreateDialogProvider, usePostCreateDialogContext] =
  createModalStoreContext<{
    boardId: string;
    status: TPostStatus;
  }>({
    name: "PostCreateDialogContext",
    hookName: "usePostCreateDialogContext",
    providerName: "PostCreateDialogProvider",
  });

import type { TPostStatus } from "@feeblo/db/schema/feedback";
import { createModalStoreContext } from "@feeblo/web-shared/xstate";
import type { NavigateOptions } from "@tanstack/react-router";

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
    boardId?: string;
    status?: TPostStatus;
    statusId?: string;
  }>({
    name: "PostCreateDialogContext",
    hookName: "usePostCreateDialogContext",
    providerName: "PostCreateDialogProvider",
  });

export const [CommentDeleteDialogProvider, useCommentDeleteDialogContext] =
  createModalStoreContext<{ commentId: string }>({
    name: "CommentDeleteDialogContext",
    hookName: "useCommentDeleteDialogContext",
    providerName: "CommentDeleteDialogProvider",
  });

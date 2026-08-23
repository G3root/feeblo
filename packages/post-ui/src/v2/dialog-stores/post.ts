import type { TPostStatusType } from "@feeblo/domain/post-status/schema";
import type { PostCreationSource } from "@feeblo/web-shared/analytics-provider";
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
    source: PostCreationSource;
    status?: TPostStatusType;
    statusId?: string;
  }>({
    name: "PostCreateDialogContext",
    hookName: "usePostCreateDialogContext",
    providerName: "PostCreateDialogProvider",
  });

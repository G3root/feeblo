import { createModalStoreContext } from "~/lib/xstate";

// biome-ignore lint/performance/noBarrelFile: <explanation>
export {
  PostCreateDialogProvider,
  PostDeleteDialogProvider,
  usePostCreateDialogContext,
  usePostDeleteDialogContext,
} from "@feeblo/post-ui/post-dialog-stores";

//TODO delete this file and use the above exports from @feeblo/post-ui/post-dialog-stores instead

export const [CommentDeleteDialogProvider, useCommentDeleteDialogContext] =
  createModalStoreContext<{ commentId: string }>({
    name: "CommentDeleteDialogContext",
    hookName: "useCommentDeleteDialogContext",
    providerName: "CommentDeleteDialogProvider",
  });

import { createModalStoreContext } from "~/utils/model-context";

export const [CreateBoardDialogProvider, useCreateBoardDialogContext] =
  createModalStoreContext({
    name: "CreateBoardDialogContext",
    hookName: "useCreateBoardDialogContext",
    providerName: "CreateBoardDialogProvider",
  });

export const [DeleteBoardDialogProvider, useDeleteBoardDialogContext] =
  createModalStoreContext<{ boardId: string }>({
    name: "DeleteBoardDialogContext",
    hookName: "useDeleteBoardDialogContext",
    providerName: "DeleteBoardDialogProvider",
  });

export const [RenameBoardDialogProvider, useRenameBoardDialogContext] =
  createModalStoreContext<{ boardId: string }>({
    name: "RenameBoardDialogContext",
    hookName: "useRenameBoardDialogContext",
    providerName: "RenameBoardDialogProvider",
  });

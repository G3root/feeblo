import { createModalStoreContext } from "~/lib/xstate";

export const [CreateRoadmapDialogProvider, useCreateRoadmapDialogContext] =
  createModalStoreContext({
    name: "CreateRoadmapDialogContext",
    hookName: "useCreateRoadmapDialogContext",
    providerName: "CreateRoadmapDialogProvider",
  });

export const [DeleteRoadmapDialogProvider, useDeleteRoadmapDialogContext] =
  createModalStoreContext<{ roadmapId: string }>({
    name: "DeleteRoadmapDialogContext",
    hookName: "useDeleteRoadmapDialogContext",
    providerName: "DeleteRoadmapDialogProvider",
  });

export const [EditRoadmapDialogProvider, useEditRoadmapDialogContext] =
  createModalStoreContext<{ roadmapId: string }>({
    name: "EditRoadmapDialogContext",
    hookName: "useEditRoadmapDialogContext",
    providerName: "EditRoadmapDialogProvider",
  });

export const [
  ToggleRoadmapVisibilityDialogProvider,
  useToggleRoadmapVisibilityDialogContext,
] = createModalStoreContext<{
  roadmapId: string;
  currentVisibility: "public" | "private";
}>({
  name: "ToggleRoadmapVisibilityDialogContext",
  hookName: "useToggleRoadmapVisibilityDialogContext",
  providerName: "ToggleRoadmapVisibilityDialogProvider",
});

import { createModalStoreContext } from "~/lib/xstate";

export const [CreateRoadmapDialogProvider, useCreateRoadmapDialogContext] =
  createModalStoreContext({
    name: "CreateRoadmapDialogContext",
    hookName: "useCreateRoadmapDialogContext",
    providerName: "CreateRoadmapDialogProvider",
  });

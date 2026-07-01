import { createStore, createStoreContext } from "@feeblo/web-shared/xstate";

export const editorStore = () =>
  createStore({
    context: {
      postContent: "",
    },
    on: {
      setPostContent: (context, event: { postContent: string }) => ({
        ...context,
        postContent: event.postContent,
      }),
    },
  });

export const [EditorProvider, useEditorContext] = createStoreContext({
  createStore: editorStore,
  name: "EditorContext",
  hookName: "useEditorContext",
  providerName: "EditorProvider",
});

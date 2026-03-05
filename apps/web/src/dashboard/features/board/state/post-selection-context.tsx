import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";
import { createStoreContext } from "~/lib/xstate";

type PostSelectionContext = {
  bulkDeleteOpen: boolean;
  selectedPostIds: string[];
  boardId: string | null;
};

const initialContext: PostSelectionContext = {
  bulkDeleteOpen: false,
  selectedPostIds: [],
  boardId: null,
};

const createPostSelectionStore = () =>
  createStore({
    context: initialContext,
    on: {
      clearSelection: (context) => ({
        ...context,
        selectedPostIds: [],
      }),
      setBulkDeleteOpen: (context, event: { open: boolean }) => ({
        ...context,
        bulkDeleteOpen: event.open,
      }),
      setBoardId: (context, event: { boardId: string }) => ({
        ...context,
        boardId: event.boardId,
      }),
      syncAvailablePostIds: (context, event: { postIds: string[] }) => {
        const available = new Set(event.postIds);
        return {
          ...context,
          selectedPostIds: context.selectedPostIds.filter((id) =>
            available.has(id)
          ),
        };
      },
      togglePostSelection: (
        context,
        event: { checked?: boolean; postId: string }
      ) => {
        const selected = new Set(context.selectedPostIds);
        const isSelected = selected.has(event.postId);
        const shouldSelect = event.checked ?? !isSelected;

        if (shouldSelect) {
          selected.add(event.postId);
        } else {
          selected.delete(event.postId);
        }

        return {
          ...context,
          selectedPostIds: [...selected],
        };
      },
    },
  });

export const [PostSelectionProvider, usePostSelectionStore] =
  createStoreContext({
    createStore: createPostSelectionStore,
    hookName: "usePostSelectionStore",
    name: "PostSelectionContext",
    providerName: "PostSelectionProvider",
  });

export function useSelectedPostIds() {
  const store = usePostSelectionStore();
  return useSelector(store, (state) => state.context.selectedPostIds);
}

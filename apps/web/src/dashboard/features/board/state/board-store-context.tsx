import { createStore } from "@xstate/store";
import { useSelector } from "@xstate/store-react";
import { createStoreContext } from "~/lib/xstate";
import type { BoardPostStatus } from "../constants";

export type BoardDisplayMode = "list" | "grid";
export type BoardPostStatusFilter = "all" | "active";
export type BoardStatusOperator = "isAnyOf" | "isNot";
export type BoardTagOperator =
  | "includeAllOf"
  | "includeAnyOf"
  | "excludeIfAnyOf"
  | "excludeIfAllOf";

const DEFAULT_STATUS_OPERATOR: BoardStatusOperator = "isAnyOf";
const DEFAULT_TAG_OPERATOR: BoardTagOperator = "includeAllOf";

export type BoardView = {
  filters: {
    postStatus: BoardPostStatusFilter;
    statusOperator: BoardStatusOperator;
    statuses: BoardPostStatus[];
    tagOperator: BoardTagOperator;
    tagIds: string[];
  };
  id: string;
  name: string;
};

type BoardStoreContext = {
  activeView: BoardView;
  boardId: string;
  bulkDeleteOpen: boolean;
  displayMode: BoardDisplayMode;
  selectedPostIds: string[];
};

export type BoardStoreDefaultValue = {
  activeView: BoardView;
  boardId: string;
  displayMode?: BoardDisplayMode;
};

const createBoardStore = (defaultValue?: BoardStoreDefaultValue) =>
  createStore({
    context: {
      activeView: defaultValue?.activeView ?? {
        id: "all-feedback",
        name: "All feedbacks",
        filters: {
          postStatus: "all",
          statusOperator: DEFAULT_STATUS_OPERATOR,
          statuses: [],
          tagOperator: DEFAULT_TAG_OPERATOR,
          tagIds: [],
        },
      },
      boardId: defaultValue?.boardId ?? "",
      bulkDeleteOpen: false,
      displayMode: defaultValue?.displayMode ?? "list",
      selectedPostIds: [],
    } as BoardStoreContext,
    on: {
      clearSelection: (context) => ({
        ...context,
        selectedPostIds: [],
      }),
      setActiveView: (context, event: { view: BoardView }) => ({
        ...context,
        activeView: event.view,
        selectedPostIds: [],
      }),
      setBulkDeleteOpen: (context, event: { open: boolean }) => ({
        ...context,
        bulkDeleteOpen: event.open,
      }),
      setDisplayMode: (context, event: { mode: BoardDisplayMode }) => ({
        ...context,
        displayMode: event.mode,
      }),
      clearFilters: (context) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            statusOperator: DEFAULT_STATUS_OPERATOR,
            statuses: [],
            tagOperator: DEFAULT_TAG_OPERATOR,
            tagIds: [],
          },
        },
      }),
      setTagOperator: (context, event: { operator: BoardTagOperator }) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            tagOperator: event.operator,
          },
        },
      }),
      setStatusOperator: (
        context,
        event: { operator: BoardStatusOperator }
      ) => ({
        ...context,
        activeView: {
          ...context.activeView,
          filters: {
            ...context.activeView.filters,
            statusOperator: event.operator,
          },
        },
      }),
      toggleTagFilter: (context, event: { tagId: string }) => {
        const tagIds = new Set(context.activeView.filters.tagIds);

        if (tagIds.has(event.tagId)) {
          tagIds.delete(event.tagId);
        } else {
          tagIds.add(event.tagId);
        }

        return {
          ...context,
          activeView: {
            ...context.activeView,
            filters: {
              ...context.activeView.filters,
              tagIds: [...tagIds],
            },
          },
        };
      },
      toggleStatusFilter: (context, event: { status: BoardPostStatus }) => {
        const statuses = new Set(context.activeView.filters.statuses);

        if (statuses.has(event.status)) {
          statuses.delete(event.status);
        } else {
          statuses.add(event.status);
        }

        return {
          ...context,
          activeView: {
            ...context.activeView,
            filters: {
              ...context.activeView.filters,
              statuses: [...statuses],
            },
          },
        };
      },
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

export const [BoardStoreProvider, useBoardStore] = createStoreContext<
  ReturnType<typeof createBoardStore>,
  BoardStoreDefaultValue
>({
  createStore: createBoardStore,
  hookName: "useBoardStore",
  name: "BoardStoreContext",
  providerName: "BoardStoreProvider",
});

export function useSelectedPostIds() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.selectedPostIds);
}

export function useBoardDisplayMode() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.displayMode);
}

export function useActiveBoardView() {
  const store = useBoardStore();
  return useSelector(store, (state) => state.context.activeView);
}
